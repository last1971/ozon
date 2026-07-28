import { Inject, Injectable, Logger } from '@nestjs/common';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbOrderDto } from './dto/wb.order.dto';
import { WbOrderStatusDto } from './dto/wb.order.status.dto';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { FirebirdTransaction } from 'ts-firebird';
import { TransactionFilterDate } from '../posting/dto/transaction.filter.dto';
import { ResultDto } from '../helpers/dto/result.dto';
import { first, min, chunk, find, filter } from 'lodash';
import { WbTransactionDto } from './dto/wb.transaction.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, Timeout } from "@nestjs/schedule";
import { WbFboOrder } from './dto/wb.fbo.order';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import Excel from 'exceljs';
import { WbOrderStickersDto } from "./dto/wb.order.stickers.dto";
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { FetchSalesByStickerCommand } from './commands/fetch-sales-by-sticker.command';
import { FetchOrdersByStickerCommand } from './commands/fetch-orders-by-sticker.command';
import { FetchTransactionsCommand } from './commands/fetch-transactions.command';
import { SelectBestIdCommand } from './commands/select-best-id.command';
import { FetchInvoiceByRemarkCommand } from './commands/fetch-invoice-by-remark.command';
import { WbInvoiceQueryDto } from '../order/dto/wb-invoice-query.dto';
import { WbInvoiceSridQueryDto } from '../order/dto/wb-invoice-srid-query.dto';
import { RateLimit, setRateLimitBlocked } from '../helpers/decorators/rate-limit.decorator';
import { IMarkSubmittable, SubmitFailureDto, SubmitResultDto } from '../interfaces/IMarkSubmittable';
import { WbOrderSetKizRequestDto } from './dto/wb.order.set-kiz.dto';
import { FboMarkMigrationService } from '../posting.fbo/fbo-mark-migration.service';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
import { goodCode, goodQuantityCoeff, isMarkCodesEnabled } from '../helpers';

@Injectable()
export class WbOrderService implements IOrderable, IMarkSubmittable {
    private readonly logger = new Logger(WbOrderService.name);
    private postingDtos: Map<string, PostingDto>;
    constructor(
        private api: WbApiService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
        private readonly fetchSalesByStickerCommand: FetchSalesByStickerCommand,
        private readonly fetchOrdersByStickerCommand: FetchOrdersByStickerCommand,
        private readonly fetchTransactionsCommand: FetchTransactionsCommand,
        private readonly selectBestIdCommand: SelectBestIdCommand,
        private readonly fetchInvoiceByRemarkCommand: FetchInvoiceByRemarkCommand,
        private readonly migrationService: FboMarkMigrationService,
        private readonly processedCache: ProcessedCacheService,
    ) {
        this.postingDtos = new Map<string, PostingDto>();
    }

    isFbo(): boolean {
        return false;
    }

    @RateLimit(200)
    async list(dateFrom = 0, initialNext = 0, limit = 1000): Promise<WbOrderDto[]> {
        const result = await this.api.method(
            '/api/v3/orders', 'get',
            { next: initialNext, limit, dateFrom }
        );

        // Handle 429 rate limit error
        if (result?.error?.status === 429) {
            const retryAfterMs = result.error.retryAfterMs || 60000;
            this.logger.warn(
                `WB API rate limit hit (429). Blocking list() for ${retryAfterMs}ms. ` +
                `Will retry on next cron iteration.`
            );
            setRateLimitBlocked('WbOrderService', 'list', Date.now() + retryAfterMs);
            return []; // Return empty, next cron will retry
        }

        const orders = result?.orders || [];
        const next = result?.next;

        // Protect against infinite loop: stop if next equals current cursor
        if (next && next !== initialNext) {
            orders.push(...(await this.list(dateFrom, next, limit)));
        }
        return orders;
    }

    async getAllFboOrders(day = 2, flag = 0): Promise<WbFboOrder[]> {
        const date = DateTime.now().minus({ day });
        return this.api.method('/api/v1/supplier/orders', 'statistics', {
            dateFrom: date.toISODate(),
            flag,
        });
    }
    async getOnlyFboOrders(day = 2, flag = 0): Promise<WbFboOrder[]> {
        const allOrders = await this.getAllFboOrders(day, flag);
        const date = DateTime.now().minus({ day });
        const fbsOrders = await this.list(date.toUnixInteger());
        const fbsRids = fbsOrders.map((order) => order.rid);
        return allOrders.filter((order) => !fbsRids.includes(order.srid));
    }
    @Cron('0 */5 * * * *', { name: 'checkFboWbOrders' })
    async addFboOrders(): Promise<boolean> {
        const allFboOrders = await this.getOnlyFboOrders(7);
        const processed = await this.processedCache.load('fbo-orders', WbOrderService.name);
        const oldFboOrders: boolean[] = await Promise.all(
            allFboOrders.map((order) => this.invoiceService.isExists(order.srid, null)),
        );
        const newFboOrders = allFboOrders.filter(
            (order, index) => !processed.has(order.srid) && !oldFboOrders[index] && !order.isCancel,
        );
        const transaction = await this.invoiceService.getTransaction();
        const buyerId = this.getBuyerId();
        const addFboOrders: WbFboOrder[] = [];
        const useMigration = this.isMarkCodesEnabled();
        try {
            for (const order of newFboOrders) {
                if (order.supplierArticle === 'wh-service-podmena') continue;
                const product: ProductPostingDto = {
                    price: order.totalPrice.toString(),
                    offer_id: order.supplierArticle,
                    quantity: 1,
                };
                const posting: PostingDto = {
                    posting_number: order.srid,
                    status: 'fbo',
                    in_process_at: order.date,
                    products: [product],
                };
                if (useMigration) {
                    // Pre-check: «левые» заказы без подбора — пропуск без создания invoice (legacy WB-spec)
                    const candidates = await this.invoiceService.findFboPodbposCandidates(
                        goodCode(product), ['WBFBO'], goodQuantityCoeff(product), transaction,
                    );
                    if (candidates.length === 0) continue;
                    const invoice = await this.invoiceService.createInvoiceFromPostingDto(
                        buyerId, posting, transaction,
                    );
                    if (!invoice) {
                        throw new Error(`WB FBO migration: счёт для ${order.srid} не создан`);
                    }
                    const shortages = await this.migrationService.migrate(
                        [product], ['WBFBO'], invoice.invoiceLines, invoice.id, transaction,
                    );
                    for (const s of shortages) {
                        await this.invoiceService.deltaGood(s.goodscode, s.quantity, 'WBFBO', transaction);
                        this.eventEmitter.emit(
                            'error.message',
                            'WB FBO: нет позиции — создана недостача',
                            `Заказ ${order.srid}, GOODSCODE ${s.goodscode}, qty ${s.quantity}`,
                        );
                    }
                    await this.invoiceService.pickupInvoice(invoice, transaction);
                } else {
                    const res = await this.invoiceService.unPickupOzonFbo(product, 'WBFBO', transaction);
                    if (!res) continue;
                    const invoice = await this.invoiceService.createInvoiceFromPostingDto(
                        buyerId, posting, transaction,
                    );
                    await this.invoiceService.pickupInvoice(invoice, transaction);
                }
                addFboOrders.push(order);
                processed.add(order.srid);
            }
            await transaction.commit(true);
            // Запись в Redis только после успешного commit
            await this.processedCache.save('fbo-orders', WbOrderService.name, processed);
            if (addFboOrders.length > 0) {
                this.eventEmitter.emit(
                    'wb.order.content',
                    'Добавлены WB FBO заказы',
                    addFboOrders.map((order) => ({ prim: order.srid, offer_id: order.supplierArticle })),
                );
            }
            return true;
        } catch (e) {
            await transaction.rollback(true);
            console.log(e);
            return false;
        }
    }

    private isMarkCodesEnabled(): boolean {
        return isMarkCodesEnabled(this.configService);
    }

    @Cron('0 */5 * * * *', { name: 'checkCanceledWbOrders' })
    async checkCanceledOrders(): Promise<void> {
        const allFboOrders = await this.getAllFboOrders(90);
        const allCanceledFboOrders = allFboOrders.filter((order) => order.isCancel);
        const dateFrom = min(
            allCanceledFboOrders
                .map((t) => t.date)
                .filter((date) => !!date)
                .map((date) => DateTime.fromISO(date).toUnixInteger()),
        );
        const orders = await this.list(dateFrom);
        const processed = await this.processedCache.load('fbo-cancellations', WbOrderService.name);
        const offerIds = new Map<string, string>();
        const prims: string[] = allCanceledFboOrders.map((order) => {
            const fbs = orders.find((o) => o.rid === order.srid);
            const prim = fbs ? fbs.id.toString() : order.srid;
            offerIds.set(prim, order.supplierArticle);
            return prim;
        });
        for (const prim of prims) {
            if (processed.has(prim)) {
                offerIds.delete(prim);
                continue;
            }
            if (await this.invoiceService.isExists(prim, null)) {
                await this.invoiceService.updatePrim(prim, prim + ' возврат WBFBO', null);
                processed.add(prim);
            } else {
                offerIds.delete(prim);
            }
        }
        await this.processedCache.save('fbo-cancellations', WbOrderService.name, processed);
        if (offerIds.size > 0) {
            this.eventEmitter.emit(
                'wb.order.content',
                'Отменены WB заказы',
                Array.from(offerIds.keys()).map((prim) => ({ prim, offer_id: offerIds.get(prim) })),
            );
        }
    }

    async listSomeDayAgo(days = 5): Promise<WbOrderDto[]> {
        const dateFrom = DateTime.now().minus({ days }).toUnixInteger();
        return this.list(dateFrom);
    }

    async orderStatuses(orders: number[]): Promise<WbOrderStatusDto[]> {
        const res = await this.api.method('/api/v3/orders/status', 'post', { orders });
        return res.orders;
    }

    public transformToPostingDto(order: WbOrderDto, status: string): PostingDto {
        const res = {
            posting_number: order.id.toString(),
            status: status,
            in_process_at: order.createdAt,
            products: [
                {
                    price: (order.convertedPrice / 100).toString(),
                    offer_id: order.article,
                    quantity: 1,
                },
            ],
        };
        this.postingDtos.set(res.posting_number, res);
        return res;
    }

    async listByStatus(orders: WbOrderDto[], status: string): Promise<PostingDto[]> {
        const statuses: WbOrderStatusDto[] = (
            await Promise.all(
                chunk(orders, 1000).map((chunkOrders: WbOrderDto[]) =>
                    this.orderStatuses(chunkOrders.map((order) => order.id)),
                ),
            )
        )
            .flat()
            .filter((status: any) => {
                return !['canceled_by_client', 'declined_by_client'].includes(status.wbStatus);
            });
        return orders
            .filter((order) => !!find(statuses, { id: order.id, supplierStatus: status }))
            .map((order) => this.transformToPostingDto(order, status));
    }

    createInvoice(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto> {
        const buyerId = this.getBuyerId();
        // this.eventEmitter.emit('wb.order.created', posting);
        return this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
    }

    async listAwaitingDelivering(): Promise<PostingDto[]> {
        const orders = await this.listSomeDayAgo();
        return this.listByStatus(orders, 'complete');
    }

    async listAwaitingPackaging(): Promise<PostingDto[]> {
        const orders = await this.listSomeDayAgo();
        const newOrders = await this.listByStatus(orders, 'new');
        const confirmOrders = await this.listByStatus(orders, 'confirm');
        return newOrders.concat(confirmOrders);
    }

    @RateLimit(60000)
    async getTransactions(data: TransactionFilterDate, rrdid = 0): Promise<Array<WbTransactionDto>> {
        // WB на пустой период отдаёт 204 No Content → axios кладёт пустую строку
        const res = await this.api.method(
            '/api/v5/supplier/reportDetailByPeriod',
            'statistics',
            {
                dateFrom: data.from,
                dateTo: data.to,
                rrdid,
            },
        );
        return Array.isArray(res) ? res : [];
    }

    async getTransactionsFromFile(file: Express.Multer.File): Promise<Array<WbTransactionDto>> {
        const workbook = new Excel.Workbook();
        await workbook.xlsx.load(file.buffer as any);
        const worksheet: Excel.Worksheet = first(workbook.worksheets);
        const ret: WbTransactionDto[] = [];
        worksheet.eachRow((row: Excel.Row, rowNumber) => {
            if (rowNumber !== 1) {
                ret.push({
                    ppvz_for_pay: row.getCell(34).value as number,
                    delivery_rub: row.getCell(37).value as number,
                    additional_payment: row.getCell(42).value as number,
                    penalty: row.getCell(41).value as number,
                    order_dt: row.getCell(12).value as string,
                    assembly_id: row.getCell(54).value as number,
                    rrd_id: null,
                    srid: row.getCell(57).value as string,
                });
            }
        });
        return ret;
    }
    async updateTransactions(data: TransactionFilterDate, file: Express.Multer.File): Promise<ResultDto> {
        const transactions = file ? await this.getTransactionsFromFile(file) : await this.getTransactions(data);
        const commissions = new Map<string, number>();
        transactions.forEach((t) => {
            const number = t.assembly_id ? t.assembly_id.toString() : t.srid;
            let amount = commissions.get(number) ?? 0;
            const { ppvz_for_pay = 0, delivery_rub = 0, additional_payment = 0, penalty = 0 } = t;
            amount += ppvz_for_pay - delivery_rub + additional_payment - penalty;
            commissions.set(number, amount);
        });
        for (const key of commissions.keys()) {
            if (commissions.get(key) <= 0) {
                commissions.delete(key);
            }
        } 
        return commissions.size > 0 
        ? this.invoiceService.updateByCommissions(commissions, null)
        : {
            isSuccess: false,
            message: 'Нет комиссий для обновления',
        };
    }

    @RateLimit(60000)
    async getSales(dateFrom: string): Promise<any> {
        return this.api.method('/api/v1/supplier/sales', 'statistics', { dateFrom });
    }

    @RateLimit(60000)
    async getOrders(dateFrom: string, flag: number = 0): Promise<any> {
        return this.api.method('/api/v1/supplier/orders', 'statistics', { dateFrom, flag });
    }
    // @Timeout(0)
    // Not test
    async closeSales(dateFrom: string = '2024-08-01', dateTo: string = '2024-09-01'): Promise<any> {
        const transaction = await this.invoiceService.getTransaction();
        try {
            console.log('Started...');
            const buyerId: number = this.getBuyerId();
            const invoices = await this.invoiceService.getByDto({ buyerId, dateFrom, dateTo, status: 4 });
            const saleIds = invoices.map((invoice) => invoice.remark);
            const sales = await this.getSales(dateFrom);
            const transactions = await this.getTransactions({ from: new Date(dateFrom), to: new Date(dateTo) });
            const orders = await this.list(DateTime.fromISO(dateFrom).toUnixInteger());
            const commissions = new Map<string, number>();
            for (const sale of saleIds) {
                const invoice: InvoiceDto = find(invoices, { remark: sale });
                let ret = find(sales, { srid: sale });
                const order = find(orders, { id: parseInt(sale) });
                if (!ret) {
                    ret = find(sales, { srid: order?.rid });
                }
                if (!ret) {
                    await this.invoiceService.unPickupAndDeltaInvoice(invoice, transaction);
                } else {
                    const { srid } = ret;
                    const t = filter(transactions, { srid });
                    const amount = t.reduce(
                        (amount, t: any) =>
                            amount +
                            (t.ppvz_for_pay ?? 0) -
                            (t.delivery_rub ?? 0) +
                            (t.additional_payment ?? 0) -
                            (t.penalty ?? 0),
                        0,
                    );
                    if (amount) {
                        commissions.set(sale, amount);
                    } else {
                        await this.invoiceService.unPickupAndDeltaInvoice(invoice, transaction);
                    }
                }
            }
            if (commissions.size > 0) await this.invoiceService.updateByCommissions(commissions, transaction);
            await transaction.commit(true);
            console.log('Finished...');
        } catch (e) {
            await transaction.rollback(true);
            console.log(e);
        }
    }

    async listCanceled(): Promise<PostingDto[]> {
        return [];
    }

    async getByPostingNumber(postingNumber: string): Promise<PostingDto> {
        let res = this.postingDtos.get(postingNumber);
        if (!res) {
            await this.listAwaitingPackaging();
            res = this.postingDtos.get(postingNumber);
        }
        return res;
    }

    getBuyerId(): number {
        return this.configService.get<number>('WB_BUYER_ID', 24532);
    }

    async getOrdersStickers(orders: number[]): Promise<WbOrderStickersDto> {
        try {
            const res = await this.api.method(
                '/api/v3/orders/stickers?type=svg&width=58&height=40',
                'post',
                { orders },
            );
            const { stickers } = res;
            return {
                stickers,
                success: true,
                error: null,
            };
        } catch (e) {
            return {
                stickers: [],
                success: false,
                error: (e as Error).message || 'Неизвестная ошибка',
            };
        }
    }

    async getInvoiceBySticker(query: WbInvoiceQueryDto): Promise<InvoiceDto | null> {
        const { dateFrom, stickerId } = query;

        const chain = new CommandChainAsync([
            this.fetchSalesByStickerCommand,      // Ищем в sales
            this.fetchOrdersByStickerCommand,     // Ищем в orders (только если не нашли в sales)
            this.fetchTransactionsCommand,        // Получаем assembly_id по srid
            this.selectBestIdCommand,             // Выбираем assembly_id или srid
            this.fetchInvoiceByRemarkCommand,     // Ищем накладную
        ]);

        const context = await chain.execute({
            dateFrom: new Date(dateFrom),
            stickerId,
        });

        return context.invoice || null;
    }

    async setOrderKiz(orderId: number, sgtins: string[]): Promise<any> {
        const body: WbOrderSetKizRequestDto = { sgtins };
        return this.api.method(`/api/v3/orders/${orderId}/meta/sgtin`, 'put', body);
    }

    async submitFbsMarkCodes(invoice: InvoiceDto): Promise<SubmitResultDto> {
        const attached = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, null);
        if (attached.length === 0) return { ok: true };

        const orderId = parseInt(invoice.remark, 10);
        if (!orderId || Number.isNaN(orderId)) {
            return {
                ok: false,
                failed: [{ ki: '*', reason: `некорректный orderId: ${invoice.remark}` }],
                skipRetry: true,
            };
        }

        // Per-order GET /orders/{id}/meta в API v3 нет (WB отвечает 405, Allow: DELETE):
        // requiredMeta отдаётся только в списке /orders/new. Но сюда мы попадаем лишь при
        // attached.length > 0 — на заказе есть привязанные КМ, значит товар маркируемый и
        // sgtin требуется. Поэтому сразу привязываем КИЗ через PUT /orders/{id}/meta/sgtin.
        const sgtins: string[] = [];
        const failed: SubmitFailureDto[] = [];
        for (const a of attached) {
            const full = await this.invoiceService.getKmFullByKi(a.ki, null);
            if (!full) failed.push({ ki: a.ki, reason: 'KM_FULL пуст' });
            else sgtins.push(full);
        }

        if (sgtins.length === 0) return { ok: false, failed };
        if (sgtins.length > 100) {
            return {
                ok: false,
                failed: [{ ki: '*', reason: '>100 КМ, нужен batching' }],
                skipRetry: true,
            };
        }

        // WbApiService на ошибке не бросает, а возвращает { status:'NotOk', error }.
        // Ловим это явно, иначе неотправленный КИЗ (405 и т.п.) уедет как ok:true,
        // крон закэширует заказ отправленным и повтора не будет.
        const resp = await this.setOrderKiz(orderId, sgtins);
        if (resp?.status === 'NotOk' || resp?.error) {
            const err = resp?.error ?? {};
            return {
                ok: false,
                failed: [
                    ...failed,
                    {
                        ki: '*',
                        reason: `WB meta/sgtin: ${err.status ?? ''} ${err.message ?? err.service_message ?? ''}`.trim(),
                    },
                ],
            };
        }

        return failed.length === 0 ? { ok: true } : { ok: false, failed };
    }

    async getInvoiceBySrid(query: WbInvoiceSridQueryDto): Promise<InvoiceDto | null> {
        const { dateFrom, srid } = query;

        // Цепочка без поиска в sales/orders, т.к. srid уже известен
        const chain = new CommandChainAsync([
            this.fetchTransactionsCommand,        // Получаем assembly_id по srid
            this.selectBestIdCommand,             // Выбираем assembly_id или srid
            this.fetchInvoiceByRemarkCommand,     // Ищем накладную
        ]);

        const context = await chain.execute({
            dateFrom: new Date(dateFrom),
            srid,
        });

        return context.invoice || null;
    }
}
