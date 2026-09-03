import { Inject, Injectable, Logger } from '@nestjs/common';
import { IInvoice } from '../interfaces/IInvoice';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { InvoiceCreateDto } from '../invoice/dto/invoice.create.dto';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { DonorDto, GoodDonorsDto, InvoiceDonorsDto } from '../invoice/dto/invoice-donors.dto';
import { TransactionDto } from '../posting/dto/transaction.dto';
import { ResultDto } from '../helpers/dto/result.dto';
import { goodCode, goodQuantityCoeff, isMarkCodesEnabled } from '../helpers';
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
import { FboMigrationLinkDto } from "../posting.fbo/dto/fbo-migration-link.dto";
import { InvoiceState } from '../helpers/accrual.distribution';
import {
    ALL_CANCELLATION_SUFFIXES,
    MP_ORDER_CANCELLATION_SUFFIX,
    OZON_INVOICE_CLOSED_SUFFIX,
    splitInvoicePrim,
} from '../helpers/order.cancellation.constants';
import { FBO_INVOICE_IGK } from '../helpers/fbo.invoice.constants';
import { InvoiceMatchDto } from '../invoice/dto/invoice.match.dto';

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
                // PIECES пишем прямо здесь: сшивать строки со списком REALPRICECODE вторым
                // проходом нельзя — при двух строках одного товара порядок вставки и порядок
                // генератора совпадать не обязаны.
                await transaction.execute(
                    'INSERT INTO REALPRICE (SCODE, GOODSCODE, QUAN, PRICE, PIECES) VALUES (?, ?, ?, ?, ?)',
                    [scode, invoiceLine.goodCode, invoiceLine.quantity, invoiceLine.price, invoiceLine.pieces ?? null],
                );
            }
            await transaction.execute('UPDATE S SET STATUS = 3 WHERE SCODE = ?', [scode]);
            const realpriceCodes = await this.findRealpriceCodes(scode, transaction);
            const invoiceLines = invoice.invoiceLines.map((line, i) => ({
                ...line,
                realpricecode: realpriceCodes[i],
            }));
            if (!t) await transaction.commit(true);
            this.eventEmitter.emit(
                'reserve.created',
                invoice.invoiceLines.map((line) => line.originalCode || line.goodCode),
            );
            return { id: scode, status: 3, ...invoice, invoiceLines };
        } catch (e) {
            this.logger.error(e.message);
            if (!t) await transaction.rollback(true);
            return null;
        }
    }

    async update(invoice: InvoiceDto, invoiceUpdateDto: InvoiceUpdateDto, t?: FirebirdTransaction): Promise<boolean> {
        return this.withTransaction(async (transaction) => {
            const fieldsToUpdate = Object.entries(invoiceUpdateDto)
                .filter(([key, value]) => value !== undefined)
                .map(([key, value]) => ({ field: key, value }));
    
            if (fieldsToUpdate.length === 0) {
                return false;
            }
    
            const setClauses = fieldsToUpdate.map(f => `${f.field} = ?`).join(', ');
            const values = fieldsToUpdate.map(f => f.value);
            const updateQuery = `UPDATE S SET ${setClauses} WHERE SCODE = ?`;
            values.push(invoice.id);
            
            await transaction.execute(updateQuery, values);
            return true;
        }, t);
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
        // String() обязателен: Яндекс отдавал номер заказа ЧИСЛОМ, а числовой параметр
        // не матчит VARCHAR PRIM — «счёта нет» на существующем счёте и дубли создания.
        const postingNumber = String(typeof posting === 'string' ? posting : posting.posting_number);
        const operator = containing ? 'CONTAINING' : '=';
        const res = await transaction.query(`SELECT * FROM S WHERE PRIM ${operator} ?`, [postingNumber], !t);
        return res.length > 0 ? InvoiceDto.map(res)[0] : null;
    }
    /**
     * Счёт по номеру отправления вместе с пометкой в `PRIM`.
     *
     * Предикат `PRIM = ? OR PRIM STARTING WITH (номер + пробел)` — ловит и переименованные
     * счета (' отмена', ' отмена FBO', ' закрыт'), и при этом не цепляет чужие номера:
     * `CONTAINING`/чистый префикс на проде врут — из 14 636 номеров 146 неоднозначны
     * (расщеплённые заказы дают …-0026-1 и …-0026-11), 399 пар, и в 30 парах короткий
     * номер имеет БОЛЬШИЙ SCODE, то есть порядок вставки не спасает.
     *
     * Дублей «два счёта на один номер» на проде нет (0 из 2953 проверенных), но если
     * вдруг придут — точное совпадение приоритетнее переименованного.
     */
    async findByPosting(
        posting: PostingDto | string,
        t: FirebirdTransaction = null,
    ): Promise<InvoiceMatchDto | null> {
        const transaction = t ?? (await this.pool.getTransaction());
        // String() обязателен: Яндекс отдавал номер заказа ЧИСЛОМ, а числовой параметр
        // не матчит VARCHAR PRIM — «счёта нет» на существующем счёте и дубли создания.
        const postingNumber = String(typeof posting === 'string' ? posting : posting.posting_number);
        const rows = await transaction.query(
            'SELECT * FROM S WHERE PRIM = ? OR PRIM STARTING WITH ?',
            [postingNumber, postingNumber + ' '],
            !t,
        );
        if (!rows.length) return null;
        const invoices = InvoiceDto.map(rows);
        const exact = invoices.find((i) => (i.remark ?? '').trim() === postingNumber);
        const invoice = exact ?? invoices[0];
        if (invoices.length > 1) {
            this.logger.warn(
                `findByPosting ${postingNumber}: найдено ${invoices.length} счетов — ` +
                    `взят ${invoice.id} (${invoices.map((i) => `${i.id}:${(i.remark ?? '').trim()}`).join(', ')})`,
            );
        }
        const mark = (invoice.remark ?? '').trim().slice(postingNumber.length);
        const cancelSuffixes: readonly string[] = ALL_CANCELLATION_SUFFIXES;
        return {
            invoice,
            mark,
            cancelled: cancelSuffixes.some((suffix) => mark.endsWith(suffix)),
            closed: mark.endsWith(OZON_INVOICE_CLOSED_SUFFIX),
        };
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

    /**
     * Состояние счетов по номерам отправлений — для разбора ожидающих начислений.
     *
     * getByPostingNumbers ищет ТОЧНЫМ равенством PRIM и переименованные не видит —
     * на этом держится гейт возвратов, трогать его нельзя. Здесь нужно отличить
     * «счёта нет» от «счёт есть, но отменён» и от «счёт уже оплачен и закрыт»:
     * к PRIM дописывается пометка. Ищем префиксом, а не списком суффиксов: их в
     * базе больше, чем кажется (закрыт 2341, отмена FBO 362, отмена 61,
     * возврат WBFBO 62 — по счетам с 01.06.2026), и словарь будет протухать.
     */
    async getInvoiceStates(postingNumbers: string[]): Promise<Map<string, InvoiceState>> {
        const unique = [...new Set(postingNumbers)];
        const states = new Map<string, InvoiceState>(
            unique.map((n) => [n, { exact: false, cancelled: false, closed: false }]),
        );
        const cancelSuffixes: readonly string[] = ALL_CANCELLATION_SUFFIXES;

        await Promise.all(
            chunk(unique, 40).map(async (part: string[]) => {
                const t = await this.pool.getTransaction(ISOLATION_READ_UNCOMMITTED);
                const rows = await t.query(
                    `SELECT PRIM FROM S WHERE ${part.map(() => 'PRIM STARTING WITH ?').join(' OR ')}`,
                    part,
                    true,
                );
                for (const row of rows) {
                    const prim = (row.PRIM ?? '').trim();
                    const state = states.get(prim);
                    if (state) {
                        state.exact = true;
                        continue;
                    }
                    // «12345-0001-1 отмена FBO» → база «12345-0001-1», пометка « отмена FBO».
                    // Префикс мог зацепить чужой номер подлиннее, поэтому проверяем пробел.
                    const space = prim.indexOf(' ');
                    if (space < 0) continue;
                    const base = prim.slice(0, space);
                    const mark = prim.slice(space);
                    const target = states.get(base);
                    if (!target) continue;
                    if (cancelSuffixes.some((suffix) => mark.endsWith(suffix))) target.cancelled = true;
                    else if (mark.endsWith(OZON_INVOICE_CLOSED_SUFFIX)) target.closed = true;
                }
            }),
        );
        return states;
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
            await t.commit(true);

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
        const BATCH_SIZE = 100;

        for (let i = 0; i < invoices.length; i += BATCH_SIZE) {
            const batch = invoices.slice(i, i + BATCH_SIZE);
            await workingTransaction.execute(
                `UPDATE S SET STATUS = ? WHERE SCODE IN (${batch.map(() => '?').join(',')})`,
                [status, ...batch.map((invoice) => invoice.id)],
                false,
            );
        }
        if (!transaction) await workingTransaction.commit(true);
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
            const total = invoices.length;
            this.logger.log(`updateByCommissions: всего ${total} записей`);
            let lastLoggedPercent = 0;

            for (let i = 0; i < invoices.length; i++) {
                const invoice = invoices[i];
                if (invoice.status === 4) {
                    const newAmount = commissions.get(invoice.remark);
                    await this.setInvoiceAmount(invoice, newAmount, transaction);
                    await this.upsertInvoiceCashFlow(invoice, newAmount, transaction);
                    await this.createTransferOut(invoice, transaction);
                    await this.updatePrim(invoice.remark, invoice.remark + OZON_INVOICE_CLOSED_SUFFIX, transaction);
                }

                const percent = Math.floor(((i + 1) / total) * 10) * 10;
                if (percent > lastLoggedPercent) {
                    this.logger.log(`updateByCommissions: обработано ${percent}%`);
                    lastLoggedPercent = percent;
                }
            }
            this.logger.log('updateByCommissions: закрываем счета-фактуры');
            await this.bulkSetStatus(invoices, 5, transaction);
            this.logger.log('updateByCommissions: коммитим транзакцию');
            if (!t) await transaction.commit(true);
            this.logger.log('updateByCommissions: вроде пронесло');
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
        this.logger.log(`updateByTransactions: начало, получено ${transactions.length} транзакций`);
        await this.cacheManager.set('updateByTransactions', true, 0);
        const transaction = t ?? (await this.pool.getTransaction());
        try {
            this.logger.log('updateByTransactions: ищем счета по posting numbers');
            const invoices: InvoiceDto[] = await this.getByPostingNumbers(transactions.map((t) => t.posting_number));
            this.logger.log(`updateByTransactions: найдено ${invoices.length} счетов`);
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

    /**
     * Признак «счёт подобран» — на уровне СЧЁТА, а не строк подбора.
     * Статусы: 3 = в подборке (идут скан/отвязка КМ), 4 = подобран. Подбор (процедура/триггер
     * внутри ФБ) переводит счёт 3 → 4. При STATUS = 4 отвязка КМ запрещена.
     * invoice.status приходит свежим из getByPosting (валидатор remark), доп. запрос не нужен.
     */
    async isPickedUp(invoice: InvoiceDto, _t: FirebirdTransaction = null): Promise<boolean> {
        return invoice.status === 4;
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
                    // Фасовка позиции: наших штук в одном юните маркетплейса. Единственное
                    // место, где она вычисляется — дальше её только читают из строки счёта.
                    // Мусорный суффикс (артикул вида «444-0») даёт 0 — пишем NULL «неизвестна»,
                    // иначе страж отверг бы по такой позиции вообще любой код.
                    pieces: goodQuantityCoeff(product) > 0 ? goodQuantityCoeff(product) : undefined,
                })),
            },
            t,
        );
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

    // Журнал недобора по FBO-счёту (нет резерва на складе — товар не списываем, спишут вручную).
    // DDL (создаётся на боевом Firebird вручную):
    //   CREATE TABLE FBO_SHORTAGE (SERVICE VARCHAR(20), POSTING VARCHAR(100), GOODSCODE INTEGER,
    //       QUANTITY INTEGER, PRIM VARCHAR(200), DATA TIMESTAMP);
    async logShortage(
        service: GoodServiceEnum,
        posting: string,
        goodscode: string,
        quantity: number,
        prim: string,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const t = transaction ?? (await this.getTransaction());
        await t.execute(
            'UPDATE OR INSERT INTO FBO_SHORTAGE (SERVICE, POSTING, GOODSCODE, QUANTITY, PRIM, DATA) ' +
                'VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) MATCHING (SERVICE, POSTING, GOODSCODE)',
            [service, posting, goodscode, quantity, prim ?? null],
            !transaction,
        );
    }

    /** Заказ есть в журнале недобора → его FBO-счёт не подбираем (иначе pickup материализует фантом). */
    async isInFboShortage(posting: string, transaction: FirebirdTransaction = null): Promise<boolean> {
        const t = transaction ?? (await this.getTransaction());
        const rows = await t.query(
            'SELECT FIRST 1 1 AS X FROM FBO_SHORTAGE WHERE POSTING = ?',
            [posting],
            !transaction,
        );
        return rows.length > 0;
    }

    /**
     * Зависшие FBO-счета для сверки: подборка идёт (`STATUS=3`), но так и не завершилась.
     *
     * `IGK='NOT1C'` — единственный надёжный признак FBO в этой таблице: покупатель у Ozon FBO и
     * Ozon FBS ОДИН (`OZON_BUYER_ID`), номера отправлений одного формата, и по PRIM их не отличить.
     * Замер на магазине 19.08.2026: среди `STATUS=3` — 106 с `NOT1C` (FBO) и 9 с `NULL`, все девять
     * оказались FBS в `awaiting_packaging`. Без этого условия сверка тянула бы счета, которые
     * кладовщик собирает прямо сейчас, а подбор такого счёта запрещает отвязку КМ.
     *
     * Из выборки вычтены:
     * - помеченные (« отмена», « отмена FBO», « закрыт») — у них своя ветка;
     * - недоборные (`FBO_SHORTAGE`) — `pickupFboUnlessShortage` их всё равно пропустит, а в выборке
     *   они копились бы вечно и раздували счётчик;
     * - старше окна — оживлять древние счета подбором нельзя.
     */
    async getStuckFboInvoices(
        buyerId: number,
        since: Date,
        transaction: FirebirdTransaction = null,
    ): Promise<InvoiceDto[]> {
        const t = transaction ?? (await this.getTransaction());
        const rows = await t.query(
            'SELECT s.* FROM S s ' +
                'WHERE s.POKUPATCODE = ? AND s.STATUS = 3 AND s.IGK = ? ' +
                'AND s.PRIM IS NOT NULL AND s.DATA >= ? ' +
                ALL_CANCELLATION_SUFFIXES.map(() => 'AND s.PRIM NOT CONTAINING ? ').join('') +
                `AND s.PRIM NOT CONTAINING ? ` +
                'AND NOT EXISTS (SELECT 1 FROM FBO_SHORTAGE f WHERE f.POSTING = s.PRIM) ' +
                'ORDER BY s.DATA',
            [
                buyerId,
                FBO_INVOICE_IGK,
                since,
                ...ALL_CANCELLATION_SUFFIXES.map((suffix) => suffix.trim()),
                OZON_INVOICE_CLOSED_SUFFIX.trim(),
            ],
            !transaction,
        );
        return InvoiceDto.map(rows);
    }

    /**
     * Подбор FBO-счёта, кроме счетов с недобором (они в FBO_SHORTAGE — ждут ручного разбора,
     * иначе pickup проставит QUANSHOP=QUANSHOPNEED и «подберёт» недостающее из воздуха).
     * Единая точка правила для Ozon (deliveryOrders) и WB (PickupFboCommand).
     */
    async pickupFboUnlessShortage(invoice: InvoiceDto, transaction: FirebirdTransaction = null): Promise<void> {
        if (await this.isInFboShortage(invoice.remark, transaction)) return;
        await this.pickupInvoice(invoice, transaction);
    }

    // Аудит цепочек FBO-миграции (донор → приёмник), append-only.
    // DDL:
    //   CREATE TABLE FBO_MIGRATION_LINK (POSTING VARCHAR(100), GOODSCODE INTEGER, QUANTITY INTEGER,
    //       DONOR_SCODE INTEGER, DONOR_RPC INTEGER, TARGET_SCODE INTEGER, TARGET_RPC INTEGER, DATA TIMESTAMP);
    async logMigrationLink(link: FboMigrationLinkDto, transaction: FirebirdTransaction = null): Promise<void> {
        const t = transaction ?? (await this.getTransaction());
        await t.execute(
            'INSERT INTO FBO_MIGRATION_LINK (POSTING, GOODSCODE, QUANTITY, DONOR_SCODE, DONOR_RPC, ' +
                'TARGET_SCODE, TARGET_RPC, DATA) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [link.posting, link.goodscode, link.quantity, link.donorScode, link.donorRpc, link.targetScode, link.targetRpc],
            !transaction,
        );
    }

    /** Сторона подбора этой инсталляции: магазин или склад. */
    private quanAttr(): 'SHOP' | 'SKLAD' {
        return this.getStorageSS() === 1 ? 'SHOP' : 'SKLAD';
    }

    /** Откуда берутся доноры — счёт с подборкой. */
    private static readonly PODBPOS_SOURCE = 'FROM PODBPOS pp JOIN S s ON s.SCODE = pp.SCODE ';

    /** Донор жив: счёт сформирован и по товару что-то подобрано. Одно место на все поиски доноров. */
    private donorAliveWhere(): string {
        return `s.STATUS = 1 AND pp.QUAN${this.quanAttr()} > 0`;
    }

    /**
     * Живые подборки по списку товаров — единственное место, где это спрашивается у базы.
     * Покупателя и исключаемый счёт задаёт вызывающий: поиск по счёту сужает доноров до
     * того же покупателя и выкидывает сам счёт, поиск по артикулу не сужает ничем.
     */
    private async queryDonors(
        goodscodes: string[],
        opts: { buyerCode?: number; excludeScode?: number },
        t: FirebirdTransaction,
    ): Promise<any[]> {
        if (goodscodes.length === 0) return [];
        const attribute = this.quanAttr();
        const where = [`pp.GOODSCODE IN (${goodscodes.map(() => '?').join(',')})`];
        const params: any[] = [...goodscodes];
        if (opts.buyerCode !== undefined) {
            where.push('s.POKUPATCODE = ?');
            params.push(opts.buyerCode);
        }
        where.push(this.donorAliveWhere());
        if (opts.excludeScode !== undefined) {
            where.push('s.SCODE <> ?');
            params.push(opts.excludeScode);
        }
        return t.query(
            `SELECT pp.GOODSCODE, pp.PODBPOSCODE, pp.QUAN${attribute} AS QUANAVAIL, ` +
                's.SCODE, s.NS, s.DATA, s.PRIM, s.POKUPATCODE ' +
                Trade2006InvoiceService.PODBPOS_SOURCE +
                `WHERE ${where.join(' AND ')} ORDER BY s.DATA`,
            params,
            false,
        );
    }

    /** Строка донора из базы в DTO — одна на обе ручки. */
    private static toDonorDto(row: any): DonorDto {
        return {
            invoiceNumber: row.NS,
            scode: row.SCODE,
            date: row.DATA ?? null,
            prim: row.PRIM ?? null,
            podbposcode: row.PODBPOSCODE,
            quantity: row.QUANAVAIL,
            buyerCode: row.POKUPATCODE,
        };
    }

    getStorageSS(): 0 | 1 {
        return this.configService.get<string>('STORAGE_TYPE', 'SHOPSKLAD').toUpperCase() === 'SHOPSKLAD' ? 1 : 0;
    }

    /**
     * Доноры под счёт, найденный по подстроке в примечании (номер отправления
     * маркетплейса лежит в S.PRIM).
     *
     * Донор — счёт ТОГО ЖЕ покупателя со статусом 1 (сформирован), где по нужному
     * товару уже что-то подобрано. Сторона подбора (QUANSHOP/QUANSKLAD) берётся
     * из режима инсталляции — тем же {@link getStorageSS}, что и FBO-поиск доноров.
     * Сам счёт из доноров исключён.
     *
     * Подстрока может совпасть с несколькими счетами — возвращаем все, каждый со
     * своим номером; пусто, если не нашлось ни одного.
     */
    async findDonorsByPrim(prim: string, transaction: FirebirdTransaction = null): Promise<InvoiceDonorsDto[]> {
        const t = transaction ?? (await this.getTransaction());

        const invoices = await this.getPrimContaining(prim, t);
        if (invoices.length === 0) {
            if (!transaction) await t.commit(true);
            return [];
        }

        const result: InvoiceDonorsDto[] = [];
        for (const inv of invoices) {
            // Строки берём своим запросом: getInvoiceLinesByInvoiceId отдаёт InvoiceLineDto
            // без REALPRICECODE и наименования, а они здесь и нужны.
            const lines = await t.query(
                'SELECT r.REALPRICECODE, r.GOODSCODE, r.QUAN, n.NAME ' +
                    'FROM REALPRICE r ' +
                    'LEFT JOIN GOODS g ON g.GOODSCODE = r.GOODSCODE ' +
                    'LEFT JOIN NAME n ON n.NAMECODE = g.NAMECODE ' +
                    'WHERE r.SCODE = ? ORDER BY r.REALPRICECODE',
                [inv.id],
                false,
            );

            const goodscodes = lines.map((l) => l.GOODSCODE);
            const donors = await this.queryDonors(
                goodscodes,
                { buyerCode: inv.buyerId, excludeScode: inv.id },
                t,
            );

            result.push({
                invoiceNumber: inv.number,
                scode: inv.id,
                date: inv.date ?? null,
                prim: inv.remark ?? null,
                buyerCode: inv.buyerId,
                lines: lines.map((l) => ({
                    realpricecode: l.REALPRICECODE,
                    goodscode: l.GOODSCODE,
                    name: l.NAME ?? null,
                    quantity: l.QUAN,
                    donors: donors
                        .filter((d) => d.GOODSCODE === l.GOODSCODE)
                        .map((d) => Trade2006InvoiceService.toDonorDto(d)),
                })),
            });
        }

        if (!transaction) await t.commit(true);
        return result;
    }

    /**
     * Доноры по артикулу маркетплейса. Счёта-получателя здесь нет, поэтому и покупателя
     * не знаем — отдаём живые подборки по товару у всех покупателей, чей счёт видно в
     * buyerCode. Артикул сводится к коду товара тем же goodCode, что и везде: фасовка
     * `552601-3` схлопывается в `552601`.
     */
    async findDonorsByArticle(article: string, transaction: FirebirdTransaction = null): Promise<GoodDonorsDto[]> {
        const t = transaction ?? (await this.getTransaction());
        const goodscode = goodCode({ offer_id: article });

        const [names, donors] = await Promise.all([
            t.query(
                'SELECT n.NAME FROM GOODS g LEFT JOIN NAME n ON n.NAMECODE = g.NAMECODE WHERE g.GOODSCODE = ?',
                [goodscode],
                false,
            ),
            this.queryDonors([goodscode], {}, t),
        ]);
        if (!transaction) await t.commit(true);

        return [
            {
                goodscode,
                name: names?.[0]?.NAME ?? null,
                donors: donors.map((d) => Trade2006InvoiceService.toDonorDto(d)),
            },
        ];
    }

    async findRealpriceCodes(
        scode: number,
        transaction: FirebirdTransaction = null,
    ): Promise<number[]> {
        const t = transaction ?? (await this.getTransaction());
        const res = await t.query(
            'SELECT REALPRICECODE FROM REALPRICE WHERE SCODE = ? ORDER BY REALPRICECODE',
            [scode],
            !transaction,
        );
        return res.map((r) => r.REALPRICECODE);
    }

    // Живой код к переносу: не отгружен фактически, не продан в розницу, не списан,
    // передан маркету. Гард несимметричный (итерация 6): у TT=2 STATUS всегда 6
    // (УПД-2 выводит код самим фактом передачи) — плоское STATUS=5 убило бы их
    // миграцию; а выведенный FBS-код (TT=3, STATUS=6) уезжать на новую FBO-продажу
    // не должен — гейт вывода требует STATUS=5, товар был бы продан дважды,
    // выведен один раз. Тот же гард стоит в MARKCODE_MIGRATE (37_fbs_sold_unsold_return.sql).
    private static readonly LIVE_CODE_FILTER =
        'm.REALPRICEFCODE IS NULL AND m.SHOPLOGCODE IS NULL AND m.SPISID IS NULL AND ' +
        '(m.TRANSFER_TYPE = 2 OR (m.TRANSFER_TYPE = 3 AND m.STATUS = 5))';

    async findFboPodbposCandidates(
        goodscode: string,
        prims: string[],
        nominal: number,
        transaction: FirebirdTransaction = null,
    ): Promise<{ podbposcode: number; scode: number; realpricecode: number; quanAvail: number; prim: string; cntNom: number; cntLive: number; cntTt3: number; cntDead: number }[]> {
        if (prims.length === 0) return [];
        const t = transaction ?? (await this.getTransaction());
        const attribute = this.quanAttr();
        const live = Trade2006InvoiceService.LIVE_CODE_FILTER;
        // Уровень склада считается в SQL: CONTAINING регистронезависим, JS includes() — нет.
        const lvlCase =
            'CASE ' + prims.map((_, i) => `WHEN s.PRIM CONTAINING ? THEN ${i} `).join('') + 'ELSE 99 END AS LVL';
        const containingClauses = prims.map(() => 's.PRIM CONTAINING ?').join(' OR ');
        const sql =
            `SELECT pp.PODBPOSCODE, pp.SCODE, rp.REALPRICECODE, pp.QUAN${attribute} AS QUANAVAIL, s.PRIM, ` +
            `(SELECT COUNT(*) FROM MARKCODES m WHERE m.REALPRICECODE = rp.REALPRICECODE AND ${live} AND COALESCE(m.QUANTITY, 1) = ?) AS CNT_NOM, ` +
            `(SELECT COUNT(*) FROM MARKCODES m WHERE m.REALPRICECODE = rp.REALPRICECODE AND ${live}) AS CNT_LIVE, ` +
            `(SELECT COUNT(*) FROM MARKCODES m WHERE m.REALPRICECODE = rp.REALPRICECODE AND ${live} AND m.TRANSFER_TYPE = 3 AND COALESCE(m.QUANTITY, 1) = ?) AS CNT_TT3, ` +
            // Выведенный FBS-код на строке (TT=3, STATUS=6): в миграцию не идёт (гард),
            // но его присутствие на доноре — сигнал «возврат проданного, код не оживлён».
            '(SELECT COUNT(*) FROM MARKCODES m WHERE m.REALPRICECODE = rp.REALPRICECODE AND ' +
            'm.REALPRICEFCODE IS NULL AND m.SHOPLOGCODE IS NULL AND m.SPISID IS NULL AND ' +
            'm.TRANSFER_TYPE = 3 AND m.STATUS = 6) AS CNT_DEAD, ' +
            `${lvlCase} ` +
            Trade2006InvoiceService.PODBPOS_SOURCE +
            'JOIN REALPRICE rp ON rp.REALPRICECODE = pp.REALPRICECODE ' +
            `WHERE pp.GOODSCODE = ? AND pp.SKLAD_ID IS NULL AND ${this.donorAliveWhere()} AND (${containingClauses})`;
        const rows = await t.query(sql, [nominal, nominal, ...prims, goodscode, ...prims], !transaction);
        const candidates = rows.map((r) => ({
            podbposcode: r.PODBPOSCODE,
            scode: r.SCODE,
            realpricecode: r.REALPRICECODE,
            quanAvail: r.QUANAVAIL,
            prim: r.PRIM,
            cntNom: Number(r.CNT_NOM) || 0,
            cntLive: Number(r.CNT_LIVE) || 0,
            cntTt3: Number(r.CNT_TT3) || 0,
            cntDead: Number(r.CNT_DEAD) || 0,
            lvl: Number(r.LVL),
        }));
        // Ярусы: (а) есть живые коды нужного номинала (вперёд — с TT=3), (б) кодов нет, (в) чужой номинал.
        const tierOf = (c: { cntNom: number; cntLive: number }): number =>
            c.cntNom > 0 ? 0 : c.cntLive === 0 ? 1 : 2;
        candidates.sort(
            (a, b) => a.lvl - b.lvl || tierOf(a) - tierOf(b) || b.cntTt3 - a.cntTt3,
        );
        return candidates;
    }

    // Legacy-донор (MARK_CODES_ENABLED=false): подборка из PODBPOS без кодов, одна строка с QUAN>=нужного,
    // с приоритетом по порядку prim. Возвращает донора для decrement + лога цепочки.
    async findFboPodbposDonor(
        goodscode: string,
        prims: string[],
        quantity: number,
        transaction: FirebirdTransaction = null,
    ): Promise<{ podbposcode: number; scode: number; realpricecode: number; quanAvail: number } | null> {
        if (prims.length === 0) return null;
        const t = transaction ?? (await this.getTransaction());
        const attribute = this.quanAttr();
        const lvlCase =
            'CASE ' + prims.map((_, i) => `WHEN s.PRIM CONTAINING ? THEN ${i} `).join('') + 'ELSE 99 END AS LVL';
        const containing = prims.map(() => 's.PRIM CONTAINING ?').join(' OR ');
        const sql =
            `SELECT FIRST 1 pp.PODBPOSCODE, pp.SCODE, pp.REALPRICECODE, pp.QUAN${attribute} AS QUANAVAIL, ${lvlCase} ` +
            Trade2006InvoiceService.PODBPOS_SOURCE +
            `WHERE pp.GOODSCODE = ? AND pp.QUAN${attribute} >= ? AND s.STATUS = 1 AND (${containing}) ORDER BY LVL`;
        const rows = await t.query(sql, [...prims, goodscode, quantity, ...prims], !transaction);
        if (rows.length === 0) return null;
        const r = rows[0];
        return {
            podbposcode: r.PODBPOSCODE,
            scode: r.SCODE,
            realpricecode: r.REALPRICECODE,
            quanAvail: r.QUANAVAIL,
        };
    }

    async findLiveMigratableCodes(
        realpricecode: number,
        nominal: number,
        transaction: FirebirdTransaction = null,
    ): Promise<{ ki: string }[]> {
        const t = transaction ?? (await this.getTransaction());
        const rows = await t.query(
            'SELECT m.KI FROM MARKCODES m WHERE m.REALPRICECODE = ? AND ' +
                Trade2006InvoiceService.LIVE_CODE_FILTER +
                ' AND COALESCE(m.QUANTITY, 1) = ? ORDER BY m.TRANSFER_TYPE DESC, m.MARKCODE',
            [realpricecode, nominal],
            !transaction,
        );
        return rows.map((r) => ({ ki: String(r.KI) }));
    }

    async migrateMarkCode(
        ki: string,
        oldRpc: number,
        newRpc: number,
        gc: string,
        s_s: 0 | 1,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const t = transaction ?? (await this.getTransaction());
        await t.execute('EXECUTE PROCEDURE MARKCODE_MIGRATE (?, ?, ?, ?, ?)', [ki, oldRpc, newRpc, gc, s_s]);
        if (!transaction) await t.commit(true);
    }

    async migratePodbpos(
        oldPodbposcode: number,
        newScode: number,
        newRpc: number,
        gc: string,
        take: number,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const t = transaction ?? (await this.getTransaction());
        await t.execute('EXECUTE PROCEDURE PODBPOS_MIGRATE_QTY (?, ?, ?, ?, ?, ?)', [
            oldPodbposcode,
            newScode,
            newRpc,
            gc,
            take,
            this.getStorageSS(),
        ]);
        if (!transaction) await t.commit(true);
    }

    // Зачистка фантомного резерва счёта Б: create() (S.STATUS 0->3) через RESERVPOS6
    // резервирует товар со свободного полочного остатка, хотя при FBO-миграции товар
    // приезжает прямым переносом со счёта А. Снимаем резерв тем же путём, что S_AU1
    // при закрытии счёта: DELETE RESERVEDPOS + зануление всех need + удаление пустых строк.
    async clearInvoiceReserve(scode: number, transaction: FirebirdTransaction = null): Promise<void> {
        const t = transaction ?? (await this.getTransaction());
        await t.execute(
            'DELETE FROM RESERVEDPOS WHERE REALPRICECODE IN (SELECT REALPRICECODE FROM REALPRICE WHERE SCODE = ?)',
            [scode],
        );
        await t.execute(
            'UPDATE PODBPOS SET QUANSKLADNEED = 0, QUANSHOPNEED = 0, QUANNEED = 0 WHERE SCODE = ?',
            [scode],
        );
        await t.execute(
            'DELETE FROM PODBPOS WHERE SCODE = ? AND QUANSKLAD = 0 AND QUANSHOP = 0 AND COALESCE(QUAN, 0) = 0',
            [scode],
        );
        if (!transaction) await t.commit(true);
    }

    async decrementPodbpos(
        podbposcode: number,
        take: number,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const t = transaction ?? (await this.getTransaction());
        const attribute = this.quanAttr();
        await t.execute(
            `UPDATE PODBPOS SET QUAN${attribute} = QUAN${attribute} - ? WHERE PODBPOSCODE = ?`,
            [take, podbposcode],
            !transaction,
        );
    }

    async attachMarkCodeForFbs(
        ki: string,
        rpc: number,
        gc: string,
        s_s: 0 | 1,
        km_full: string,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const t = transaction ?? (await this.getTransaction());
        await t.execute(
            'EXECUTE PROCEDURE MARKCODE_ATTACH_FOR_FBS (?, ?, ?, ?, ?)',
            [ki, rpc, gc, s_s, km_full],
        );
        if (!transaction) await t.commit(true);
    }

    async detachMarkCodeForFbs(
        ki: string,
        rpc: number,
        s_s: 0 | 1,
        transaction: FirebirdTransaction = null,
    ): Promise<void> {
        const t = transaction ?? (await this.getTransaction());
        await t.execute('EXECUTE PROCEDURE MARKCODE_DETACH_FOR_FBS (?, ?, ?)', [ki, rpc, s_s]);
        if (!transaction) await t.commit(true);
    }

    /**
     * Вернуть коды счёта на склад: `TT 3→0` через `MARKCODE_RETURN_TO_STOCK`.
     *
     * `REALPRICECODE` процедура НЕ трогает — код остаётся привязанным к строке счёта.
     * Это принципиально: при расформировании в Дельфи `CountAttachedMarks` отбирает
     * ровно `TRANSFER_TYPE = 0` по `REALPRICECODE` и по этому счётчику заставляет
     * кладовщика отсканировать коды из коробки. Снимешь привязку заодно — Дельфи
     * расформирует молча, и содержимое посылки никто не сверит.
     *
     * @returns сколько кодов вернули.
     */
    async returnMarkCodesToStock(scode: number, transaction: FirebirdTransaction = null): Promise<number> {
        const t = transaction ?? (await this.getTransaction());
        try {
            const codes = await this.getAttachedMarkCodesByScode(scode, t);
            const ss = this.getStorageSS();
            for (const code of codes) {
                await this.markCodeReturnToStock(code.ki, ss, t);
            }
            if (!transaction) await t.commit(true);
            return codes.length;
        } catch (e) {
            if (!transaction) await t.rollback(true).catch(() => undefined);
            throw e;
        }
    }

    /** TT 3→0 одного кода (MARKCODE_RETURN_TO_STOCK): привязка остаётся, партийный резерв снимается. */
    async markCodeReturnToStock(ki: string, s_s: 0 | 1, transaction: FirebirdTransaction): Promise<void> {
        await transaction.execute('EXECUTE PROCEDURE MARKCODE_RETURN_TO_STOCK (?, ?)', [ki, s_s]);
    }

    /** Вывод кода по нашей FBS-продаже: 5→6, RETIRE_REASON=1, RETIRED_AT (MARKCODE_FBS_SOLD). */
    async markCodeFbsSold(ki: string, transaction: FirebirdTransaction): Promise<void> {
        await transaction.execute('EXECUTE PROCEDURE MARKCODE_FBS_SOLD (?)', [ki]);
    }

    /** Откат вывода по нашей продаже: 6→5 (MARKCODE_FBS_UNSOLD, только RETIRE_REASON=1). */
    async markCodeFbsUnsold(ki: string, transaction: FirebirdTransaction): Promise<void> {
        await transaction.execute('EXECUTE PROCEDURE MARKCODE_FBS_UNSOLD (?)', [ki]);
    }

    async countFreeMarkCodesForGood(
        goodscode: string,
        transaction: FirebirdTransaction = null,
    ): Promise<number> {
        const t = transaction ?? (await this.getTransaction());
        const res = await t.query(
            'SELECT FREE_COUNT FROM COUNT_FREE_MARKCODES_FOR_GOOD (?)',
            [goodscode],
            !transaction,
        );
        return res?.[0]?.FREE_COUNT ?? 0;
    }

    async getMarkCodeInfoByKi(
        ki: string,
        transaction: FirebirdTransaction = null,
    ): Promise<{ goodscode: string; quantity: number } | null> {
        const t = transaction ?? (await this.getTransaction());
        const res = await t.query(
            'SELECT GOODSCODE, COALESCE(QUANTITY, 1) AS QUANTITY FROM MARKCODES WHERE KI = ?',
            [ki],
            !transaction,
        );
        if (res?.[0]?.GOODSCODE == null) return null;
        return { goodscode: String(res[0].GOODSCODE), quantity: Number(res[0].QUANTITY) || 1 };
    }

    async getKmFullByKi(
        ki: string,
        transaction: FirebirdTransaction = null,
    ): Promise<string | null> {
        const t = transaction ?? (await this.getTransaction());
        const res = await t.query('SELECT KM_FULL FROM MARKCODES WHERE KI = ?', [ki], !transaction);
        return res?.[0]?.KM_FULL != null ? String(res[0].KM_FULL) : null;
    }

    /**
     * Озон принимает ГТД строго 3 частями (8/6/7 цифр, regex ^[0-9]{8}/[0-9]{6}/[0-9]{7}$).
     * В БД ГТД бывает с хвостом (номер позиции), напр. 10228010/260326/5094327/2 — обрезаем до 3 частей.
     * Пусто → null (тогда is_gtd_absent=true).
     *
     * Не попавшее в формат Озона тоже отдаём null: у старых партий (до ~2011) номер декларации
     * содержит литеру — 10210090/160910/п014454, семи цифр там нет и не будет. Слать такое нельзя:
     * exemplar/set проходит, а validate валится regex-ошибкой и отгрузка встаёт целиком.
     */
    private normalizeGtd(raw: unknown): string | null {
        if (raw == null) return null;
        const s = String(raw).trim();
        if (!s) return null;
        const gtd = s.split('/').slice(0, 3).join('/');
        if (!/^[0-9]{8}\/[0-9]{6}\/[0-9]{7}$/.test(gtd)) {
            this.logger.warn(`ГТД "${s}" не в формате Озона — отправляем как is_gtd_absent`);
            return null;
        }
        return gtd;
    }

    /**
     * ГТД МАРКИРОВАННОГО кода из ПРИХОДА (не расхода — его для несобранного заказа ещё нет):
     * MARKCODES.PR_META_IN_ID → PR_META.SKLADINCODE|SHOPINCODE → SKLADIN.GTD | SHOPIN→SHOPINPR.GTD.
     * Нет ссылки на приход/пустой GTD → null. Для НЕмаркированного — getPickedPartiesGtdByScode.
     */
    async getGtdByKi(ki: string, transaction: FirebirdTransaction = null): Promise<string | null> {
        const own = !transaction;
        const t = transaction ?? (await this.getTransaction());
        try {
            const meta = await t.query(
                'SELECT FIRST 1 pm.SKLADINCODE, pm.SHOPINCODE FROM MARKCODES m ' +
                    'JOIN PR_META pm ON pm.ID = m.PR_META_IN_ID WHERE m.KI = ?',
                [ki],
                false,
            );
            const row = meta?.[0];
            let gtd: unknown = null;
            if (row?.SKLADINCODE) {
                const r = await t.query('SELECT GTD FROM SKLADIN WHERE SKLADINCODE = ?', [row.SKLADINCODE], false);
                gtd = r?.[0]?.GTD;
            } else if (row?.SHOPINCODE) {
                // магазин: у SHOPIN своей GTD нет — цепочка SHOPIN.SHOPINPRCODE → SHOPINPR.GTD
                const r = await t.query(
                    'SELECT sp.GTD FROM SHOPIN si JOIN SHOPINPR sp ON sp.SHOPINPRCODE = si.SHOPINPRCODE ' +
                        'WHERE si.SHOPINCODE = ?',
                    [row.SHOPINCODE],
                    false,
                );
                gtd = r?.[0]?.GTD;
            }
            return this.normalizeGtd(gtd);
        } finally {
            if (own) await t.commit(true).catch(() => undefined);
        }
    }

    /**
     * ГТД НЕмаркированных позиций счёта — по ФАКТИЧЕСКОЙ FIFO-раскладке уже подобранного счёта
     * (не пересчёт остатка: подбор пишет FIFO_T до УПД, поэтому «QUAN − Σ FIFO_T» вернул бы чужие партии).
     * Цепочка: PODBPOS(SCODE) → PR_META(расход, по PODBPOSCODE) → FIFO_T → PR_META(приход) → ГТД.
     * Источник ГТД по инстансу (getStorageSS): склад → SKLADIN.GTD; магазин → SHOPIN→SHOPINPR.GTD.
     * Возврат: партии по строкам счёта (realpricecode + кол-во из партии + ГТД партии). ГТД пусто → null.
     */
    async getPickedPartiesGtdByScode(
        scode: number,
        transaction: FirebirdTransaction = null,
    ): Promise<{ realpricecode: number; goodscode: string; quantity: number; gtd: string | null }[]> {
        const t = transaction ?? (await this.getTransaction());
        const gtdExpr =
            this.getStorageSS() === 1
                ? '(SELECT sp.GTD FROM SHOPIN si JOIN SHOPINPR sp ON sp.SHOPINPRCODE = si.SHOPINPRCODE ' +
                  'WHERE si.SHOPINCODE = pin.SHOPINCODE)'
                : '(SELECT s.GTD FROM SKLADIN s WHERE s.SKLADINCODE = pin.SKLADINCODE)';
        const rows = await t.query(
            'SELECT pp.REALPRICECODE, pp.GOODSCODE, f.QUAN AS PARTY_QUAN, ' +
                gtdExpr +
                ' AS GTD ' +
                'FROM PODBPOS pp ' +
                'JOIN PR_META pout ON pout.PODBPOSCODE = pp.PODBPOSCODE AND pout.P_R = 1 ' +
                'JOIN FIFO_T f ON f.PR_META_OUT_ID = pout.ID ' +
                'JOIN PR_META pin ON pin.ID = f.PR_META_IN_ID ' +
                'WHERE pp.SCODE = ? ' +
                'ORDER BY pp.REALPRICECODE, f.ID',
            [scode],
            !transaction,
        );
        return (rows ?? []).map((r) => ({
            realpricecode: Number(r.REALPRICECODE),
            goodscode: String(r.GOODSCODE),
            quantity: Number(r.PARTY_QUAN) || 0,
            gtd: this.normalizeGtd(r.GTD),
        }));
    }

    async listFbsAwaitingShip(
        buyerId: number,
        transaction: FirebirdTransaction = null,
    ): Promise<InvoiceDto[]> {
        const t = transaction ?? (await this.getTransaction());
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 2);
        fromDate.setHours(0, 0, 0, 0);
        const rows = await t.query(
            'SELECT DISTINCT s.* FROM S s ' +
                'JOIN REALPRICE rp ON rp.SCODE = s.SCODE ' +
                'JOIN MARKCODES m ON m.REALPRICECODE = rp.REALPRICECODE ' +
                'WHERE s.POKUPATCODE = ? ' +
                "AND s.FINISH_PICKUP IS NOT NULL " +
                "AND s.IGK IS NOT NULL AND s.IGK <> '' " +
                'AND m.TRANSFER_TYPE = 3 ' +
                'AND s.DATA >= ?',
            [buyerId, fromDate],
            !transaction,
        );
        return InvoiceDto.map(rows);
    }

    async getAttachedMarkCodesByScode(
        scode: number,
        transaction: FirebirdTransaction = null,
    ): Promise<{ ki: string; goodscode: string; realpricecode: number; quantity: number }[]> {
        // Маркировка выключена (магазин) → таблицы MARKCODES нет. Кодов нет по определению.
        if (!isMarkCodesEnabled(this.configService)) return [];
        const t = transaction ?? (await this.getTransaction());
        const rows = await t.query(
            'SELECT m.KI, m.GOODSCODE, m.REALPRICECODE, COALESCE(m.QUANTITY, 1) AS QUANTITY FROM MARKCODES m ' +
                'JOIN REALPRICE rp ON rp.REALPRICECODE = m.REALPRICECODE ' +
                'WHERE rp.SCODE = ? AND m.TRANSFER_TYPE = 3',
            [scode],
            !transaction,
        );
        return rows.map((r) => ({
            ki: r.KI,
            goodscode: String(r.GOODSCODE),
            realpricecode: r.REALPRICECODE,
            quantity: Number(r.QUANTITY) || 1,
        }));
    }

    /**
     * Полное состояние кодов счёта — вход слоя 2 решающей таблицы.
     *
     * В отличие от `getAttachedMarkCodesByScode` не фильтрует по `TRANSFER_TYPE`:
     * решение зависит и от TT=2 (передан по УПД-2 — трогать нельзя), и от STATUS
     * с RETIRE_REASON (выведен нашей продажей или по другой причине).
     */
    async getMarkCodesStateByScode(
        scode: number,
        transaction: FirebirdTransaction = null,
    ): Promise<
        { ki: string; status: number; transferType: number; retireReason: number | null; kmFull: string | null; price: number | null }[]
    > {
        // Маркировка выключена (магазин) — таблицы MARKCODES нет.
        if (!isMarkCodesEnabled(this.configService)) return [];
        const t = transaction ?? (await this.getTransaction());
        const rows = await t.query(
            'SELECT m.KI, m.STATUS, m.TRANSFER_TYPE, m.RETIRE_REASON, m.KM_FULL, rp.PRICE FROM MARKCODES m ' +
                'JOIN REALPRICE rp ON rp.REALPRICECODE = m.REALPRICECODE ' +
                'WHERE rp.SCODE = ?',
            [scode],
            !transaction,
        );
        return rows.map((r) => ({
            ki: String(r.KI),
            status: Number(r.STATUS),
            transferType: Number(r.TRANSFER_TYPE),
            retireReason: r.RETIRE_REASON === null || r.RETIRE_REASON === undefined ? null : Number(r.RETIRE_REASON),
            kmFull: r.KM_FULL ?? null,
            price: r.PRICE === null || r.PRICE === undefined ? null : Number(r.PRICE),
        }));
    }

    /**
     * Подвисшие коды: ушли маркетплейсу (TT=2/3) и остались в обороте (STATUS=5)
     * на счёте, которого уже нет в работе, — либо выведены нашей FBS-продажей
     * (STATUS=6, RETIRE_REASON=1) на счёте, ставшем донором: товар вернулся и
     * уехал новой продажей, а код не оживлён (unretire не случился — например,
     * возврат разобрал старый путь, который кодов не знает).
     *
     * Счета в статусах 3 и 4 (создан-не-собран, подобран) исключены: код с TT=3
     * на таком счёте — это нормальная сборка FBS, а не висяк. НО счёт в 4 старше
     * 30 дней — уже не сборка (дальняя доставка + недельный цикл выплат укладываются
     * с запасом): 93 ВБ-счёта с июльскими кодами стояли в 4 и были невидимы отчёту.
     * Отгруженные, списанные и проданные в розницу коды отсеиваются теми же полями,
     * что и в LIVE_CODE_FILTER. Индекс IDX_MC_TRANSFER_STATUS (TRANSFER_TYPE, STATUS).
     *
     * Возраст считается по дате СЧЁТА: STATUS_UPDATED_AT для этого не годится —
     * триггер MARKCODES_BU двигает его только при смене STATUS, а у висяка STATUS
     * как раз и не менялся с момента ввода в оборот.
     */
    async findStuckMarkCodes(
        minAgeDays = 3,
        transaction: FirebirdTransaction = null,
    ): Promise<
        {
            ki: string;
            goodscode: string;
            status: number;
            transferType: number;
            scode: number | null;
            invoiceNumber: number | null;
            prim: string | null;
            invoiceStatus: number | null;
            invoiceDate: Date | null;
        }[]
    > {
        if (!isMarkCodesEnabled(this.configService)) return [];
        const t = transaction ?? (await this.getTransaction());
        const edge = DateTime.now().minus({ day: minAgeDays }).startOf('day').toJSDate();
        const pickedEdge = DateTime.now().minus({ day: 30 }).startOf('day').toJSDate();
        const rows = await t.query(
            'SELECT m.KI, m.GOODSCODE, m.STATUS, m.TRANSFER_TYPE, s.SCODE, s.NS, s.PRIM, s.STATUS AS S_STATUS, s.DATA ' +
                'FROM MARKCODES m ' +
                'LEFT JOIN REALPRICE rp ON rp.REALPRICECODE = m.REALPRICECODE ' +
                'LEFT JOIN S s ON s.SCODE = rp.SCODE ' +
                'WHERE m.TRANSFER_TYPE IN (2, 3) ' +
                'AND m.REALPRICEFCODE IS NULL AND m.SHOPLOGCODE IS NULL AND m.SPISID IS NULL ' +
                // Висяк в обороте: STATUS=5 на счёте вне работы, либо на счёте,
                // «собранном» дольше месяца (S.STATUS=4 старше 30 дн — не сборка).
                // Висяк выведенный: STATUS=6 нашей продажей (RETIRE_REASON=1) на
                // счёте-доноре («отмена» в PRIM) — товар вернулся и уехал заново,
                // а код никто не оживил.
                'AND ((m.STATUS = 5 AND (s.SCODE IS NULL OR s.STATUS NOT IN (3, 4) OR (s.STATUS = 4 AND s.DATA < ?))) ' +
                'OR (m.STATUS = 6 AND m.RETIRE_REASON = 1 AND s.PRIM CONTAINING ?)) ' +
                'AND (s.DATA IS NULL OR s.DATA < ?) ' +
                'ORDER BY s.DATA',
            // Литерал пометки не пишем: единая точка правды — MP_ORDER_CANCELLATION_SUFFIX.
            // CONTAINING по « отмена» ловит и « отмена FBO» — так и задумано, это счёт-донор.
            [pickedEdge, MP_ORDER_CANCELLATION_SUFFIX.REGULAR.trim(), edge],
            !transaction,
        );
        return rows.map((r) => ({
            ki: String(r.KI),
            goodscode: String(r.GOODSCODE),
            status: Number(r.STATUS),
            transferType: Number(r.TRANSFER_TYPE),
            scode: r.SCODE ?? null,
            invoiceNumber: r.NS ?? null,
            prim: r.PRIM ?? null,
            invoiceStatus: r.S_STATUS === null || r.S_STATUS === undefined ? null : Number(r.S_STATUS),
            invoiceDate: r.DATA ?? null,
        }));
    }

    /**
     * Счета с пометкой « отмена» — той, что значит «товар физически у нас».
     *
     * Вход суточной сверки: по каждому такому счёту спрашиваем маркетплейс, не завёл ли
     * он возврат — то есть не уехала ли коробка к нему вопреки пометке (живые случаи
     * 26.08.2026: счета №16713 и №16559).
     *
     * Расформированные (STATUS=0) БЕРЁМ, хотя «исправлять» там уже нечего: письмо отмены
     * прямым текстом велит кладовщику расформировать счёт, и если коробки он не нашёл, а
     * она уехала к маркетплейсу — на полке появился фантомный остаток. Молчать об этом
     * нельзя, сверка покажет их отдельным разделом. Закрытые (STATUS=5) не берём: счёт
     * проведён и оплачен, трогать его отчётом смысла нет. На проде за три месяца из 84
     * помеченных 65 расформированы и 17 закрыты, и записей возврата у них нет ни одной —
     * то есть расширение выборки шума не добавляет.
     *
     * Суффикс берётся из единой точки правды (`MP_ORDER_CANCELLATION_SUFFIX`), а не литералом:
     * `LIKE '% отмена'` намеренно не ловит ` отмена FBO` — тот счёт уже донор, он исправлен.
     */
    async findPlainCancelledInvoices(
        days: number,
        transaction: FirebirdTransaction = null,
    ): Promise<{ scode: number; number: number | null; prim: string; posting: string; status: number; date: Date | null }[]> {
        const t = transaction ?? (await this.getTransaction());
        const suffix = MP_ORDER_CANCELLATION_SUFFIX.REGULAR;
        const edge = DateTime.now().minus({ day: days }).startOf('day').toJSDate();
        const rows = await t.query(
            'SELECT s.SCODE, s.NS, s.PRIM, s.STATUS, s.DATA FROM S s ' +
                'WHERE s.PRIM LIKE ? AND s.DATA >= ? AND s.STATUS <> 5 ' +
                'ORDER BY s.DATA',
            [`%${suffix}`, edge],
            !transaction,
        );
        return rows.map((r) => {
            // Разбор PRIM — единой функцией из order.cancellation.constants:
            // своего slice по длине суффикса здесь быть не должно.
            const { posting } = splitInvoicePrim(String(r.PRIM ?? ''));
            return {
                scode: Number(r.SCODE),
                number: r.NS ?? null,
                prim: String(r.PRIM ?? '').trim(),
                posting,
                status: Number(r.STATUS),
                date: r.DATA ?? null,
            };
        });
    }

    async getRealpriceLinesByScode(
        scode: number,
        transaction: FirebirdTransaction = null,
    ): Promise<{ realpricecode: number; goodscode: string; quantity: number; pieces: number | null }[]> {
        const t = transaction ?? (await this.getTransaction());
        const rows = await t.query(
            'SELECT REALPRICECODE, GOODSCODE, QUAN, PIECES FROM REALPRICE WHERE SCODE = ?',
            [scode],
            !transaction,
        );
        return rows.map((r) => ({
            realpricecode: r.REALPRICECODE,
            goodscode: String(r.GOODSCODE),
            quantity: r.QUAN,
            // null — фасовка неизвестна: строка создана до появления поля либо записана
            // мусором (0/отрицательное). Решения по такой строке принимаются по-старому.
            pieces: Number(r.PIECES) > 0 ? Number(r.PIECES) : null,
        }));
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
