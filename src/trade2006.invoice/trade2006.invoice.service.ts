import { Inject, Injectable, Logger } from '@nestjs/common';
import { IInvoice } from '../interfaces/IInvoice';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { InvoiceCreateDto } from '../invoice/dto/invoice.create.dto';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { TransactionDto } from '../posting/dto/transaction.dto';
import { ResultDto } from '../helpers/result.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { chunk, flatten } from 'lodash';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cache } from '@nestjs/cache-manager';
import { InvoiceGetDto } from '../invoice/dto/invoice.get.dto';
import { InvoiceLineDto } from '../invoice/dto/invoice.line.dto';
import { ISOLATION_READ_UNCOMMITTED } from 'node-firebird';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class Trade2006InvoiceService implements IInvoice {
    private logger = new Logger(Trade2006InvoiceService.name);
    // private fboErrors: { prim: string; code: string }[] = [];
    constructor(
        @Inject(FIREBIRD) private pool: FirebirdPool,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
        private cacheManager: Cache,
    ) {}

    async getTransaction(): Promise<FirebirdTransaction> {
        return this.pool.getTransaction();
    }
    async create(invoice: InvoiceCreateDto, t: FirebirdTransaction = null): Promise<InvoiceDto> {
        const transaction = t ?? (await this.pool.getTransaction());
        try {
            const firmId = this.configService.get<number>('FIRM_ID', 31);
            const staffId = this.configService.get<number>('STAFF_ID', 25);
            const number =
                ((
                    await transaction.query('SELECT MAX(NS) FROM S WHERE FIRM_ID = ? AND DATA >= ?', [
                        firmId,
                        DateTime.fromJSDate(invoice.date).startOf('year').toISODate(),
                    ])
                )[0].MAX || 0) + 1;
            await transaction.execute(
                'INSERT INTO S (POKUPATCODE, DATA, PRIM, NS, STATUS, FIRM_ID, STAFF_ID) VALUES (?, ?, ?, ?, 0, ?, ?)',
                [invoice.buyerId, invoice.date, invoice.remark, number, firmId, staffId],
            );
            const scode = (await transaction.query('SELECT GEN_ID(SCODE_GEN, 0) from rdb$database', []))[0].GEN_ID;
            for (const invoiceLine of invoice.invoiceLines) {
                await transaction.execute('INSERT INTO REALPRICE (SCODE, GOODSCODE, QUAN, PRICE) VALUES (?, ?, ?, ?)', [
                    scode,
                    invoiceLine.goodCode,
                    invoiceLine.quantity,
                    invoiceLine.price,
                ]);
            }
            await transaction.execute('UPDATE S SET STATUS = 3 WHERE SCODE = ?', [scode]);
            if (!t) await transaction.commit(true);
            this.eventEmitter.emit(
                'reserve.created',
                invoice.invoiceLines.map((line) => line.originalCode || line.goodCode),
            );
            return { id: scode, status: 3, ...invoice };
        } catch (e) {
            this.logger.error(e.message);
            if (!t) await transaction.rollback(true);
            return null;
        }
    }

    async isExists(remark: string, t: FirebirdTransaction = null): Promise<boolean> {
        const transaction = t ?? (await this.pool.getTransaction());
        const res = await transaction.query('SELECT SCODE FROM S WHERE PRIM = ?', [remark], !t);
        return res.length > 0;
    }

    // возможно добавить передачу статуса в этот метод и переименовать его
    async updatePrim(prim: string, newPrim: string, t: FirebirdTransaction = null): Promise<void> {
        const transaction = t ?? (await this.pool.getTransaction());
        await transaction.execute('UPDATE S SET PRIM = ?, STATUS = 1 WHERE PRIM = ?', [newPrim, prim], !t);
    }

    async getByPosting(posting: PostingDto, t: FirebirdTransaction = null): Promise<InvoiceDto> {
        const transaction = t ?? (await this.pool.getTransaction());
        const res = await transaction.query('SELECT * FROM S WHERE PRIM = ?', [posting.posting_number], !t);
        return res.length > 0
            ? {
                  id: res[0].SCODE,
                  buyerId: res[0].POKUPATCODE,
                  date: new Date(res[0].DATA),
                  remark: res[0].PRIM,
                  status: res[0].STATUS,
              }
            : null;
    }
    async getByPostingNumbers(postingNumbers: string[]): Promise<InvoiceDto[]> {
        const invoices = flatten(
            await Promise.all(
                chunk(postingNumbers, 50).map(async (part: string[]) => {
                    const t = await this.pool.getTransaction(ISOLATION_READ_UNCOMMITTED);
                    return t.query(
                        `SELECT *
                 FROM S
                 WHERE PRIM IN (${'?'.repeat(part.length).split('').join()})`,
                        part,
                        true,
                    );
                }),
            ),
        );
        return InvoiceDto.map(invoices);
    }

    async getByDto(invoiceGetDto: InvoiceGetDto): Promise<InvoiceDto[]> {
        const t = await this.pool.getTransaction();
        let sql = 'SELECT * FROM S WHERE 1=1';
        const params = [];
        if (invoiceGetDto.dateTo) {
            sql += ' AND DATA <= ?';
            params.push(invoiceGetDto.dateTo);
        }
        if (invoiceGetDto.dateFrom) {
            sql += ' AND DATA >= ?';
            params.push(invoiceGetDto.dateFrom);
        }
        if (invoiceGetDto.buyerId) {
            sql += ' AND POKUPATCODE = ?';
            params.push(invoiceGetDto.buyerId);
        }
        if (invoiceGetDto.status) {
            sql += ' AND STATUS = ?';
            params.push(invoiceGetDto.status);
        }
        const res = await t.query(sql, params, true);
        return res.map((invoice) => ({
            id: invoice.SCODE,
            buyerId: invoice.POKUPATCODE,
            date: new Date(invoice.DATA),
            remark: invoice.PRIM,
            status: invoice.STATUS,
        }));
    }

    @Cron('0 0 * * * 0', { name: 'clearOldFormed' })
    async clearOldFormed(): Promise<void> {
        const transaction = await this.pool.getTransaction();
        await transaction.execute(
            'UPDATE S SET STATUS = 5 WHERE NOT EXISTS (SELECT 1 FROM PODBPOS P WHERE P.SCODE = S.SCODE) AND S.STATUS < 2 AND S.DATA < ?',
            [DateTime.now().minus({ month: 2 }).toISODate()],
            true,
        );
    }

    async getByBuyerAndStatus(buyerId: number, status: number, t: FirebirdTransaction = null): Promise<InvoiceDto[]> {
        const transaction = t ?? (await this.pool.getTransaction());
        const invoices = await transaction.query(
            'SELECT * FROM S WHERE POKUPATCODE = ? AND STATUS = ?',
            [buyerId, status],
            !t,
        );
        return InvoiceDto.map(invoices);
    }
    async bulkSetStatus(
        invoices: InvoiceDto[],
        status: number,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const workingTransaction = transaction ?? (await this.pool.getTransaction());
        await workingTransaction.execute(
            `UPDATE S SET STATUS = ? WHERE SCODE IN (${'?'.repeat(invoices.length).split('').join()})`,
            [status, ...invoices.map((invoice) => invoice.id)],
            !transaction,
        );
    }
    async upsertInvoiceCashFlow(
        invoice: InvoiceDto,
        amount: number,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const workingTransaction = transaction ?? (await this.pool.getTransaction());
        await workingTransaction.execute(
            'UPDATE OR INSERT INTO SCHET (MONEYSCHET, NS, DATA, POKUPATCODE, SCODE) VALUES (?, ?, ?, ?,' +
                ' ?) MATCHING (SCODE)',
            [amount, invoice.number, new Date(), this.configService.get<number>('BUYER_ID', 24416), invoice.id],
            !transaction,
        );
    }
    async setInvoiceAmount(
        invoice: InvoiceDto,
        newAmount: number,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const workingTransaction = transaction ?? (await this.pool.getTransaction());
        const lines = await workingTransaction.query('SELECT * FROM REALPRICE WHERE SCODE = ?', [invoice.id]);
        const oldAmount = lines.reduce((s, line) => s + parseFloat(line.SUMMAP), 0);
        for (const line of lines) {
            await workingTransaction.execute('UPDATE REALPRICE SET SUMMAP = ? WHERE REALPRICECODE = ?', [
                (newAmount * parseFloat(line.SUMMAP)) / oldAmount,
                line.REALPRICECODE,
            ]);
        }
        if (!transaction) await workingTransaction.commit(true);
    }
    async createTransferOut(invoice: InvoiceDto, transaction: FirebirdTransaction = null): Promise<void> {
        const workingTransaction = transaction ?? (await this.pool.getTransaction());
        await workingTransaction.execute(
            'EXECUTE PROCEDURE CREATESF9 (?, ?, ?, ?, ?)',
            [null, invoice.id, this.configService.get<number>('STAFF_ID', 25), null, 0],
            !transaction,
        );
    }
    async updateByCommissions(commissions: Map<string, number>, t: FirebirdTransaction = null): Promise<ResultDto> {
        const transaction = t ?? (await this.pool.getTransaction());
        try {
            const invoices = await this.getByPostingNumbers(Array.from(commissions.keys()));
            for (const invoice of invoices) {
                if (invoice.status === 4) {
                    const newAmount = commissions.get(invoice.remark);
                    await this.setInvoiceAmount(invoice, newAmount, transaction);
                    await this.upsertInvoiceCashFlow(invoice, newAmount, transaction);
                    await this.createTransferOut(invoice, transaction);
                    await this.updatePrim(invoice.remark, invoice.remark + ' закрыт', transaction);
                }
            }
            await this.bulkSetStatus(invoices, 5, transaction);
            if (!t) await transaction.commit(true);
            return { isSuccess: true };
        } catch (e) {
            this.logger.error(e.message);
            if (!t) await transaction.rollback(true);
            return {
                isSuccess: false,
                message: e.message,
            };
        }
    }
    async updateByTransactions(transactions: TransactionDto[], t: FirebirdTransaction = null): Promise<ResultDto> {
        await this.cacheManager.set('updateByTransactions', true, 0);
        const transaction = t ?? (await this.pool.getTransaction());
        try {
            const invoices = await this.getByPostingNumbers(transactions.map((t) => t.posting_number));
            if (invoices.length !== transactions.length) {
                const delta = transactions.filter(
                    (dto) => !invoices.find((invoice) => invoice.remark === dto.posting_number),
                );
                if (!t) await transaction.rollback(true);
                await this.cacheManager.set('updateByTransactions', false, 0);
                return {
                    isSuccess: false,
                    message: `Not find ${delta.map((invoice) => invoice.posting_number).toString()}`,
                };
            }
            const commissions = new Map<string, number>();
            invoices.forEach((invoice) => {
                const newAmount = transactions.find((dto) => dto.posting_number === invoice.remark).amount;
                commissions.set(invoice.remark, newAmount);
            });
            /*
            for (const invoice of invoices) {
                if (invoice.status === 4) {
                    const newAmount = transactions.find((dto) => dto.posting_number === invoice.remark).amount;
                    await this.setInvoiceAmount(invoice, newAmount, transaction);
                    await this.upsertInvoiceCashFlow(invoice, newAmount, transaction);
                    await this.createTransferOut(invoice, transaction);
                }
            }
            await this.bulkSetStatus(invoices, 5, transaction);
            if (!t) await transaction.commit(true);
            return { isSuccess: true };

             */
            const res = await this.updateByCommissions(commissions, t);
            await this.cacheManager.set('updateByTransactions', false, 0);
            return res;
        } catch (e) {
            this.logger.error(e.message);
            if (!t) await transaction.rollback(true);
            await this.cacheManager.set('updateByTransactions', false, 0);
            return {
                isSuccess: false,
                message: e.message,
            };
        }
    }
    async pickupInvoice(invoice: InvoiceDto, t: FirebirdTransaction = null): Promise<void> {
        if (invoice.status === 3) {
            const transaction = t ?? (await this.pool.getTransaction());
            await transaction.execute('UPDATE PODBPOS SET QUANSHOP = QUANSHOPNEED WHERE SCODE = ?', [invoice.id], !t);
            this.logger.log(`Order ${invoice.remark} has been pickuped`);
        }
    }

    async createInvoiceFromPostingDto(
        buyerId: number,
        posting: PostingDto,
        t: FirebirdTransaction = null,
    ): Promise<InvoiceDto> {
        this.logger.log(`Create order ${posting.posting_number} with ${posting.products.length} lines for ${buyerId}`);
        return this.create(
            {
                buyerId,
                date: new Date(posting.in_process_at),
                remark: posting.posting_number.toString(),
                invoiceLines: posting.products.map((product) => ({
                    goodCode: goodCode(product),
                    quantity: product.quantity * goodQuantityCoeff(product),
                    price: (parseFloat(product.price) / goodQuantityCoeff(product)).toString(),
                    originalCode: product.offer_id,
                })),
            },
            t,
        );
    }
    async unPickupOzonFbo(
        product: ProductPostingDto,
        prim: string,
        transaction: FirebirdTransaction = null,
    ): Promise<boolean> {
        const workingTransaction = transaction || (await this.getTransaction());
        const code = goodCode(product);
        const quantity = product.quantity * goodQuantityCoeff(product);
        const pickups = await workingTransaction.query(
            'SELECT PODBPOSCODE, QUANSHOP FROM PODBPOS WHERE GOODSCODE = ? AND QUANSHOP >= ? AND SCODE IN (SELECT SCODE' +
                ' FROM S WHERE S.STATUS = 1 AND S.PRIM CONTAINING ?)',
            [code, quantity, prim],
        );
        if (pickups.length === 0) {
            if (!transaction) await workingTransaction.rollback(true);
            const message = `Have not position on FBO. Warehouse - ${prim}. GOODSCODE - ${code}.`;
            // if (!find(this.fboErrors, { prim, code })) {
            //    this.fboErrors.push({ prim, code });
            this.eventEmitter.emit('error.message', 'Check FBO cancels!', message);
            // }
            // throw new Error(message);
            return false;
        }
        // remove(this.fboErrors, { prim, code });
        await workingTransaction.execute('UPDATE PODBPOS SET QUANSHOP = ? WHERE PODBPOSCODE = ?', [
            pickups[0].QUANSHOP - quantity,
            pickups[0].PODBPOSCODE,
        ]);
        if (!transaction) await workingTransaction.commit(true);
        return true;
    }

    async getLastIncomingPrice(id: string, transaction: FirebirdTransaction = null): Promise<number> {
        const workingTransaction = transaction || (await this.getTransaction());
        const res = await workingTransaction.query(
            'select first 1 * from trueprih where goodscode = ? and for_shop=1 order by data desc',
            [id],
            !transaction,
        );
        return res ? res[0]?.PRICE : 0.01;
    }

    async deltaGood(
        id: string,
        quantity: number,
        prim: string,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const workingTransaction = transaction || (await this.getTransaction());
        const price = await this.getLastIncomingPrice(id, workingTransaction);
        await workingTransaction.execute(
            'execute procedure deltaquanshopsklad4 ?, ?, ?, ?, ?, null, 1',
            [id, Trade2006InvoiceService.name, -quantity, prim, price],
            !transaction,
        );
        this.eventEmitter.emit('error.message', `Delta ${id} code with quantity: ${quantity} for ${prim}`);
    }
    async getInvoiceLines(invoice: InvoiceDto, transaction: FirebirdTransaction = null): Promise<InvoiceLineDto[]> {
        const t = transaction || (await this.getTransaction());
        const lines = await t.query('SELECT * FROM REALPRICE WHERE SCODE = ?', [invoice.id], !transaction);
        return lines.map(
            (line): InvoiceLineDto => ({
                goodCode: line.GOODSCODE,
                price: line.PRICE,
                quantity: line.QUAN,
            }),
        );
    }
    async unPickupAndDeltaInvoice(invoice: InvoiceDto, transaction: FirebirdTransaction): Promise<void> {
        await this.bulkSetStatus([invoice], 1, transaction);
        const lines = await this.getInvoiceLines(invoice, transaction);
        const product: ProductPostingDto = {
            price: lines[0].price,
            offer_id: lines[0].goodCode.toString(),
            quantity: lines[0].quantity,
        };
        const res = await this.unPickupOzonFbo(product, invoice.remark, transaction);
        if (!res) throw new Error('Not find lines for ' + invoice.remark);
        await this.deltaGood(product.offer_id, -product.quantity, 'WBFBO Correction', transaction);
    }
}
