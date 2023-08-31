import { Inject, Injectable, Logger } from '@nestjs/common';
import { IInvoice } from '../interfaces/IInvoice';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdDatabase, FirebirdTransaction } from 'ts-firebird';
import { InvoiceCreateDto } from '../invoice/dto/invoice.create.dto';
import Firebird from 'node-firebird';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { TransactionDto } from '../posting/dto/transaction.dto';
import { ResultDto } from '../helpers/result.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { chunk, flatten } from 'lodash';

@Injectable()
export class Trade2006InvoiceService implements IInvoice {
    private logger = new Logger(Trade2006InvoiceService.name);
    constructor(
        @Inject(FIREBIRD) private db: FirebirdDatabase,
        private configService: ConfigService,
    ) {}

    async create(invoice: InvoiceCreateDto): Promise<InvoiceDto> {
        const transaction = await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED);
        try {
            const firmId = this.configService.get<number>('FIRM_ID', 31);
            const staffId = this.configService.get<number>('STAFF_ID', 25);
            const number =
                ((
                    await transaction.query('SELECT MAX(NS) FROM S WHERE FIRM_ID = ? AND DATA > ?', [
                        firmId,
                        DateTime.now().startOf('year').toISODate(),
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
            await transaction.commit();
            return { id: scode, status: 3, ...invoice };
        } catch (e) {
            this.logger.error(e.message);
            await transaction.rollback();
            return null;
        }
    }

    async isExists(remark: string): Promise<boolean> {
        const res = await this.db.query('SELECT SCODE FROM S WHERE PRIM = ?', [remark]);
        return res.length > 0;
    }
    async getByPosting(posting: PostingDto): Promise<InvoiceDto> {
        const res = await this.db.query('SELECT * FROM S WHERE PRIM = ?', [posting.posting_number]);
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
    async getByPostingNumbers(
        postingNumbers: string[],
        transaction: FirebirdTransaction = null,
    ): Promise<InvoiceDto[]> {
        const workingTransaction = transaction ?? (await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED));
        const invoices = flatten(
            await Promise.all(
                chunk(postingNumbers, 50).map((part: string[]) =>
                    workingTransaction.query(
                        `SELECT *
                 FROM S
                 WHERE PRIM IN (${'?'.repeat(part.length).split('').join()})`,
                        part,
                        !transaction,
                    ),
                ),
            ),
        );
        return InvoiceDto.map(invoices);
    }
    async getByBuyerAndStatus(buyerId: number, status: number): Promise<InvoiceDto[]> {
        const invoices = await this.db.query('SELECT * FROM S WHERE POKUPATCODE = ? AND STATUS = ?', [buyerId, status]);
        return InvoiceDto.map(invoices);
    }
    async bulkSetStatus(
        invoices: InvoiceDto[],
        status: number,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const workingTransaction = transaction ?? (await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED));
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
        const workingTransaction = transaction ?? (await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED));
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
        const workingTransaction = transaction ?? (await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED));
        const lines = await workingTransaction.query(
            'SELECT * FROM REALPRICE WHERE SCODE = ?',
            [invoice.id],
            !transaction,
        );
        const oldAmount = lines.reduce((s, line) => s + parseFloat(line.SUMMAP), 0);
        for (const line of lines) {
            await workingTransaction.execute(
                'UPDATE REALPRICE SET SUMMAP = ? WHERE REALPRICECODE = ?',
                [(newAmount * parseFloat(line.SUMMAP)) / oldAmount, line.REALPRICECODE],
                !transaction,
            );
        }
    }
    async createTransferOut(invoice: InvoiceDto, transaction: FirebirdTransaction = null): Promise<void> {
        const workingTransaction = transaction ?? (await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED));
        await workingTransaction.execute(
            'EXECUTE PROCEDURE CREATESF9 (?, ?, ?, ?, ?)',
            [null, invoice.id, this.configService.get<number>('STAFF_ID', 25), null, 0],
            !transaction,
        );
    }
    async updateByCommissions(commissions: Map<string, number>): Promise<ResultDto> {
        const transaction = await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED);
        try {
            const invoices = await this.getByPostingNumbers(Array.from(commissions.keys()), transaction);
            for (const invoice of invoices) {
                const newAmount = commissions.get(invoice.remark);
                await this.setInvoiceAmount(invoice, newAmount, transaction);
                await this.upsertInvoiceCashFlow(invoice, newAmount, transaction);
                await this.createTransferOut(invoice, transaction);
            }
            await this.bulkSetStatus(invoices, 5, transaction);
            await transaction.commit();
            return { isSuccess: true };
        } catch (e) {
            this.logger.error(e.message);
            await transaction.rollback();
            return {
                isSuccess: false,
                message: e.message,
            };
        }
    }
    async updateByTransactions(transactions: TransactionDto[]): Promise<ResultDto> {
        const transaction = await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED);
        try {
            const invoices = await this.getByPostingNumbers(
                transactions.map((t) => t.posting_number),
                transaction,
            );
            if (invoices.length !== transactions.length) {
                const delta = transactions.filter(
                    (t) => !invoices.find((invoice) => invoice.remark === t.posting_number),
                );
                await transaction.rollback();
                return {
                    isSuccess: false,
                    message: `Not find ${delta.map((invoice) => invoice.posting_number).toString()}`,
                };
            }
            for (const invoice of invoices) {
                if (invoice.status === 5) {
                    await transaction.rollback();
                    return {
                        isSuccess: false,
                        message: `Invoice № ${invoice.number} has wrong status`,
                    };
                }
                const newAmount = transactions.find((t) => t.posting_number === invoice.remark).amount;
                await this.setInvoiceAmount(invoice, newAmount, transaction);
                await this.upsertInvoiceCashFlow(invoice, newAmount, transaction);
                await this.createTransferOut(invoice, transaction);
            }
            await this.bulkSetStatus(invoices, 5, transaction);
            await transaction.commit();
            return { isSuccess: true };
        } catch (e) {
            this.logger.error(e.message);
            await transaction.rollback();
            return {
                isSuccess: false,
                message: e.message,
            };
        }
    }
    async pickupInvoice(invoice: InvoiceDto): Promise<void> {
        if (invoice.status === 3) {
            await this.db.execute('UPDATE PODBPOS SET QUANSHOP = QUANSHOPNEED WHERE SCODE = ?', [invoice.id]);
            this.logger.log(`Order ${invoice.remark} has been pickuped`);
        }
    }

    async createInvoiceFromPostingDto(buyerId: number, posting: PostingDto): Promise<InvoiceDto> {
        this.logger.log(`Create order ${posting.posting_number} with ${posting.products.length} lines for ${buyerId}`);
        //const buyerId = this.configService.get<number>('BUYER_ID', 24416);
        return this.create({
            buyerId,
            date: new Date(posting.in_process_at),
            remark: posting.posting_number.toString(),
            invoiceLines: posting.products.map((product) => ({
                goodCode: goodCode(product),
                quantity: product.quantity * goodQuantityCoeff(product),
                price: (parseFloat(product.price) / goodQuantityCoeff(product)).toString(),
            })),
        });
    }
}
