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
import { ResultDto } from '../helpers/dto/result.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { chunk, flatten, toNumber } from 'lodash';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cache } from '@nestjs/cache-manager';
import { InvoiceGetDto } from '../invoice/dto/invoice.get.dto';
import { InvoiceLineDto } from '../invoice/dto/invoice.line.dto';
import { ISOLATION_READ_UNCOMMITTED } from 'node-firebird';
import { Cron } from '@nestjs/schedule';
import { ISuppliable } from '../interfaces/i.suppliable';
import { SupplyDto } from '../supply/dto/supply.dto';
import { GoodServiceEnum } from '../good/good.service.enum';
import { SupplyPositionDto } from '../supply/dto/supply.position.dto';
import { IProductable } from '../interfaces/i.productable';
import { InvoiceUpdateDto } from "../invoice/dto/invoice.update.dto";
import { TransferOutDTO } from "./dto/transfer.out.dto";
import { TransferOutLineDTO } from "./dto/transfer.out.line.dto";
import { plainToClass } from "class-transformer";
import { WithTransactions } from "../helpers/mixin/transaction.mixin";

@Injectable()
export class Trade2006InvoiceService extends WithTransactions(class {}) implements IInvoice, ISuppliable {
    private logger = new Logger(Trade2006InvoiceService.name);
    // private fboErrors: { prim: string; code: string }[] = [];
    constructor(
        @Inject(FIREBIRD) private pool: FirebirdPool,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
        private cacheManager: Cache,
    ) {
        super();
    }

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

    async update(invoice: InvoiceDto, invoiceUpdateDto: InvoiceUpdateDto): Promise<boolean> {
        const transaction = await this.pool.getTransaction();

        const fieldsToUpdate = Object.entries(invoiceUpdateDto) // Перебираем все пары ключ-значение
            .filter(([key, value]) => value !== undefined) // Оставляем только поля, где значение не undefined
            .map(([key, value]) => ({ field: key, value })); // Преобразуем в массив объектов с полями и значениями

        // Если нет полей для обновления, выбрасываем ошибку
        if (fieldsToUpdate.length === 0) {
            return false;
        }

        // Строим SQL-запрос динамически
        const setClauses = fieldsToUpdate.map(f => `${f.field} = ?`).join(', ');
        const values = fieldsToUpdate.map(f => f.value);
        const updateQuery = `UPDATE S SET ${setClauses} WHERE SCODE = ?`;
        values.push(invoice.id); // Добавляем значение SCODE для WHERE
        await transaction.execute(updateQuery, values, true);
        return true;
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

    async getByPosting(posting: PostingDto | string, t: FirebirdTransaction = null, containing: boolean = false): Promise<InvoiceDto> {
        const transaction = t ?? (await this.pool.getTransaction());
        const postingNumber = typeof posting === 'string' ? posting : posting.posting_number;
        const operator = containing ? 'CONTAINING' : '=';
        const res = await transaction.query(`SELECT * FROM S WHERE PRIM ${operator} ?`, [postingNumber], !t);
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
        const conditions = ['1=1'];
        const params = [];

        const filters = [
            { condition: invoiceGetDto.dateTo ? 'DATA <= ?' : null, param: invoiceGetDto.dateTo },
            { condition: invoiceGetDto.dateFrom ? 'DATA >= ?' : null, param: invoiceGetDto.dateFrom },
            { condition: invoiceGetDto.buyerId ? 'POKUPATCODE = ?' : null, param: invoiceGetDto.buyerId },
            { condition: invoiceGetDto.status ? 'STATUS = ?' : null, param: invoiceGetDto.status },
        ];

        // Добавляем базовые фильтры
        filters.forEach(({ condition, param }) => condition && (conditions.push(condition), params.push(param)));

        // Обработка remarks
        if (Array.isArray(invoiceGetDto.remarks) && invoiceGetDto.remarks.length) {
            const chunkSize = 50; // Размер чанка
            const allInvoices: InvoiceDto[] = [];

            // Разбиваем remarks на чанки
            for (let i = 0; i < invoiceGetDto.remarks.length; i += chunkSize) {
                const chunkRemarks = invoiceGetDto.remarks.slice(i, i + chunkSize);
                const placeholders = chunkRemarks.map(() => '?').join(',');
                
                // Создаем SQL для текущего чанка
                const chunkConditions = [...conditions, `PRIM IN (${placeholders})`];
                const chunkParams = [...params, ...chunkRemarks];
                
                const sql = `SELECT * FROM S WHERE ${chunkConditions.join(' AND ')}`;
                const res = await t.query(sql, chunkParams, false);
                
                allInvoices.push(...res.map((invoice) => ({
                    id: invoice.SCODE,
                    buyerId: invoice.POKUPATCODE,
                    date: new Date(invoice.DATA),
                    remark: invoice.PRIM,
                    status: invoice.STATUS,
                })));
            }
            await t.commit(false);

            return allInvoices;
        }

        // Если нет remarks, выполняем обычный запрос
        const sql = `SELECT * FROM S WHERE ${conditions.join(' AND ')}`;
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
            [amount, invoice.number, new Date(), this.configService.get<number>('OZON_BUYER_ID', 24416), invoice.id],
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
            const invoices: InvoiceDto[] = await this.getByPostingNumbers(transactions.map((t) => t.posting_number));
            let res: ResultDto;
            if (invoices.length === 0) {
                res = {
                    isSuccess: false,
                    message: `Nothing to do`,
                };
            } else if (invoices.length > transactions.length) {
                res = {
                    isSuccess: false,
                    message: `Invoices more than transactions`,
                };
            } else {
                const commissions = new Map<string, number>();
                invoices.forEach((invoice) => {
                    const tr = transactions.find((dto) => dto.posting_number === invoice.remark);
                    if (tr) {
                        commissions.set(invoice.remark, tr.amount);
                    }
                });
                res = await this.updateByCommissions(commissions, t);
                if (invoices.length < transactions.length) {
                    const delta = transactions.filter(
                        (dto) => !invoices.find((invoice) => invoice.remark === dto.posting_number),
                    );
                    res.message = `Not find ${delta.map((invoice) => invoice.posting_number).toString()}`;
                }
            }
            /*
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

            */
            await this.cacheManager.set('updateByTransactions', false, 0);
            if (!t) await transaction.commit(true);
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
        const attribute = this.configService.get<string>('STORAGE_TYPE', 'SHOPSKLAD').toUpperCase() === 'SHOPSKLAD'
            ? 'SHOP'
            : 'SKLAD';
        if (invoice.status === 3) {
            const transaction = t ?? (await this.pool.getTransaction());
            await transaction.execute(`UPDATE PODBPOS SET QUAN${attribute}= QUAN${attribute}NEED WHERE SCODE = ?`, [invoice.id], !t);
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
        const attribute = this.configService.get<string>('STORAGE_TYPE', 'SHOPSKLAD').toUpperCase() === 'SHOPSKLAD'
            ? 'SHOP'
            : 'SKLAD';
        const pickups = await workingTransaction.query(
            `SELECT PODBPOSCODE, QUAN${attribute} FROM PODBPOS WHERE GOODSCODE = ? AND QUAN${attribute} >= ? AND SCODE IN (SELECT SCODE` +
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
        await workingTransaction.execute(`UPDATE PODBPOS SET QUAN${attribute} = ? WHERE PODBPOSCODE = ?`, [
            pickups[0].QUANSHOP - quantity,
            pickups[0].PODBPOSCODE,
        ]);
        if (!transaction) await workingTransaction.commit(true);
        return true;
    }

    async getLastIncomingPrice(id: string, transaction: FirebirdTransaction = null): Promise<number> {
        const workingTransaction = transaction || (await this.getTransaction());
        const forPrih = this.configService.get<string>('STORAGE_TYPE', 'SHOPSKLAD').toUpperCase() === 'SHOPSKLAD' ? 1 : 0;
        const res = await workingTransaction.query(
            'select first 1 * from trueprih where goodscode = ? and for_shop = ? order by data desc',
            [id, forPrih],
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
        const procedure = this.configService.get<string>('STORAGE_TYPE', 'SHOPSKLAD').toUpperCase() === 'SHOPSKLAD'
            ? 'deltaquanshopsklad4'
            : 'deltaquansklad4';
        await workingTransaction.execute(
            `execute procedure ${procedure} ?, ?, ?, ?, ?, null, 1`,
            [id, Trade2006InvoiceService.name, -quantity, prim, price],
            !transaction,
        );
        this.eventEmitter.emit('error.message', `Delta ${id} code with quantity: ${quantity} for ${prim}`);
    }
    async getInvoiceLines(invoice: InvoiceDto, transaction: FirebirdTransaction = null): Promise<InvoiceLineDto[]> {
        return this.getInvoiceLinesByInvoiceId(invoice.id, transaction);
    }
    async getInvoiceLinesByInvoiceId(id: number, transaction: FirebirdTransaction = null): Promise<InvoiceLineDto[]> {
        const t = transaction || (await this.getTransaction());
        const lines = await t.query('SELECT * FROM REALPRICE WHERE SCODE = ?', [id], !transaction);
        return lines.map(
            (line): InvoiceLineDto => ({
                goodCode: line.GOODSCODE,
                price: line.PRICE,
                quantity: line.QUAN,
                whereOrdered: line.WHERE_ORDERED,
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

    async getPrimContaining(search: string, transaction: FirebirdTransaction = null): Promise<InvoiceDto[]> {
        const t = transaction || (await this.getTransaction());
        const invoices = await t.query('SELECT * FROM S WHERE PRIM CONTAINING ?', [search], !transaction);
        return InvoiceDto.map(invoices);
    }

    async getSupplies(): Promise<SupplyDto[]> {
        const invoices = await this.getPrimContaining('FORFBO');
        const buyerId = this.configService.get<number>('OZON_BUYER_ID', 24416);
        return invoices.map(
            (invoice): SupplyDto => ({
                id: invoice.id.toString(),
                isMarketplace: false,
                remark: invoice.remark,
                goodService: buyerId === invoice.buyerId ? GoodServiceEnum.OZON : GoodServiceEnum.WB,
            }),
        );
    }

    async getSupplyPositions(id: string, productable: IProductable): Promise<SupplyPositionDto[]> {
        const lines = await this.getInvoiceLinesByInvoiceId(toNumber(id));
    
        // Собираем все SKU для batch запроса
        const skus = lines.map(line => {
            const { goodCode, whereOrdered } = line;
            return whereOrdered ? `${goodCode}-${whereOrdered}` : goodCode.toString();
        });

        // Получаем информацию о всех продуктах одним запросом
        const productsInfo = await productable.infoList(skus);

        // Создаем мапу для быстрого доступа к информации о продуктах
        const productsMap = new Map(
            productsInfo.map(product => [product.sku, product])
        );

        // Формируем результат
        return lines.map(line => {
            const { goodCode, whereOrdered } = line;
            const sku = whereOrdered ? `${goodCode}-${whereOrdered}` : goodCode.toString();
            const product = productsMap.get(sku);

            if (!product) {
                throw new Error(`Product not found for SKU: ${sku}`);
            }

            return {
                supplyId: id,
                barCode: product.barCode,
                remark: product.remark,
                quantity: toNumber(line.quantity) / (toNumber(whereOrdered) || 1),
            };
        });
    }

    async getTransferOutByNumberAndDate(number: number, date: string, existingTransaction: FirebirdTransaction = null): Promise<TransferOutDTO> {
        return this.withTransaction(async (transaction) => {
            const res = await transaction.query(
                'SELECT * FROM SF WHERE NSF = ? AND CAST(DATA AS DATE) = CAST(? AS DATE)',
                [number, date],
            );
            if (res.length === 0) {
                return null;
            }
            return plainToClass(TransferOutDTO, res[0]);
        }, existingTransaction);
    }

    async getTransferOutLines(transferOutId: number, existingTransaction: FirebirdTransaction = null): Promise<TransferOutLineDTO[]> {
        return this.withTransaction(async (transaction) => {
            const res = await transaction.query(
                'SELECT * FROM REALPRICEF WHERE SFCODE = ?',
                [transferOutId],
            );
            return res.map(record => plainToClass(TransferOutLineDTO, record));
        }, existingTransaction);
    }

    distributeAmountProportionally(amount: number, lines: TransferOutLineDTO[]): TransferOutLineDTO[] {
        if (lines.length === 0) {
            return [];
        }

        // Берем абсолютные значения сумм для пропорционального распределения
        const totalCurrentAmount = lines.reduce((sum, line) => sum + Math.abs(line.totalAmount), 0);
        
        if (totalCurrentAmount <= 0) {
            return lines;
        }

        return lines.map(line => ({
            ...line,
            totalAmount: (amount * Math.abs(line.totalAmount)) / totalCurrentAmount
        }));
    }

    async updateTransferOutLinesAmounts(lines: TransferOutLineDTO[], existingTransaction: FirebirdTransaction = null): Promise<void> {
        return this.withTransaction(async (transaction) => {
            for (const line of lines) {
                // Обновляем сумму в строке УПД (REALPRICEF)
                await transaction.execute(
                    'UPDATE REALPRICEF SET SUMMAP = ? WHERE REALPRICEFCODE = ?',
                    [line.totalAmount, line.id]
                );

                // Если есть связь со строкой счета, обновляем и её
                if (line.invoiceLineId) {
                    await transaction.execute(
                        'UPDATE REALPRICE SET SUMMAP = ? WHERE REALPRICECODE = ?',
                        [line.totalAmount, line.invoiceLineId]
                    );
                }
            }
        }, existingTransaction);
    }

    async distributePaymentByUPD(updNumber: number, updDate: string, amount: number): Promise<ResultDto> {
        return this.withTransaction(async (transaction) => {
            try {
                // 1. Получаем УПД
                const transferOut = await this.getTransferOutByNumberAndDate(updNumber, updDate, transaction);
                if (!transferOut) {
                    throw new Error('404: УПД не найден');
                }

                // 2. Получаем строки УПД
                const transferOutLines = await this.getTransferOutLines(transferOut.id, transaction);
                if (transferOutLines.length === 0) {
                    throw new Error('404: Строки УПД не найдены');
                }

                // 3. Меняем сумму (пропорционально распределяем)
                const updatedLines = this.distributeAmountProportionally(amount, transferOutLines);

                // 4. Сохраняем сумму в строки
                await this.updateTransferOutLinesAmounts(updatedLines, transaction);

                // 5. Обновляем сумму в деньгах
                await this.upsertInvoiceCashFlow(
                    { id: transferOut.invoiceId, buyerId: transferOut.buyerId, date: transferOut.date, remark: '', status: 0 },
                    amount,
                    transaction
                );

                return { isSuccess: true, message: 'Платеж успешно распределен' };
            } catch (error) {
                if (error.message.startsWith('404:')) {
                    return { isSuccess: false, message: error.message };
                }
                return { isSuccess: false, message: `Ошибка при распределении платежа: ${error.message}` };
            }
        });
    }

}
