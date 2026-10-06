import { Injectable, Logger } from '@nestjs/common';
import { IOrderable } from '../interfaces/IOrderable';
import { IFboSales } from '../interfaces/IFboSales';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { ProductService } from '../product/product.service';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { FirebirdTransaction } from 'ts-firebird';
// import { Cron } from '@nestjs/schedule';
import { isMarkCodesEnabled } from '../helpers';
import { MP_ORDER_CANCELLATION_SUFFIX } from '../helpers/order.cancellation.constants';
import { GoodServiceEnum } from '../good/good.service.enum';
import { FboInvoiceCreatorService } from './fbo-invoice-creator.service';
import { MpEventService } from '../mp-event/mp-event.service';
import { IFboReconcilable } from '../interfaces/IFboReconcilable';

@Injectable()
export class PostingFboService implements IOrderable, IFboSales, IFboReconcilable {
    private logger = new Logger(PostingFboService.name);
    constructor(
        private productService: ProductService,
        private configService: ConfigService,
        private fboInvoiceCreator: FboInvoiceCreatorService,
        private mpEvent: MpEventService,
    ) {}

    isFbo(): boolean {
        return true;
    }

    async createInvoice(
        posting: PostingDto,
        transaction: FirebirdTransaction,
        flushers?: (() => Promise<void>)[],
    ): Promise<InvoiceDto | null> {
        const warehouseName = posting.analytics_data?.warehouse_name;
        const clusterFrom = posting.financial_data?.cluster_from;
        const suffix = MP_ORDER_CANCELLATION_SUFFIX.FBO.trim();
        const prims = [warehouseName, clusterFrom, suffix].filter((p): p is string => Boolean(p));

        return this.fboInvoiceCreator.create({
            service: GoodServiceEnum.OZON,
            posting,
            prims,
            primLabel: clusterFrom || warehouseName,
            buyerId: this.getBuyerId(),
            useMigration: isMarkCodesEnabled(this.configService),
            setIgkNot1c: true,
            pickupAfterCreate: false,
            skipIfNoPodbor: false,
            transaction,
            flushers,
        });
    }

    async list(status: string, day = 2): Promise<PostingDto[]> {
        const all = await this.fetch(status, day);
        // Журнал: на нём стоит расширение окна при пропущенном прогоне.
        for (const posting of all) {
            try {
                await this.mpEvent.record({
                    service: 'OZON',
                    kind: 'POSTING_FBO',
                    extId: posting.posting_number,
                    state: status,
                    posting: posting.posting_number,
                });
            } catch (e) {
                this.logger.warn(`журнал: ${posting.posting_number}/${status} не записан — ${e.message}`);
            }
        }
        return all;
    }

    /** Отправления статуса за окно — без записи в журнал (её делает вызывающий). */
    private async fetch(status: string, day: number): Promise<PostingDto[]> {
        // У FBO фильтр по дате смены статуса мёртвый (обмерено: окна 1 ч, 24 ч, 72 ч и
        // заведомо пустое дают одни и те же записи), поэтому инкрементально сузить выборку
        // нечем — окно по дате СОЗДАНИЯ читается целиком каждый раз. Журнал здесь нужен
        // ровно для одного: если суточный прогон пропускался, окно РАСШИРЯЕТСЯ до перекрытия
        // простоя. Поэтому берём то из двух начал, которое раньше.
        const byDefault = DateTime.now().minus({ day }).startOf('day');
        const byJournal = DateTime.fromJSDate(
            await this.mpEvent.windowStart('OZON', 'POSTING_FBO', day, PostingFboService.OVERLAP_DAYS),
        );
        const filter = {
            since: (byJournal < byDefault ? byJournal : byDefault).toJSDate(),
            to: DateTime.now().endOf('day').toJSDate(),
            statuses: [status],
        };
        const limit = 100; // предел v3 — 100, в v2 было 1000
        const all: PostingDto[] = [];
        let cursor = '';
        let hasMore = true;
        // Пагинации здесь не было вовсе: с limit 1000 хватало одного запроса, но новый
        // предел 100 молча обрезал бы выборку (у магазина отмен за 90 дней больше 1000).
        while (hasMore) {
            const orders = await this.productService.orderFboList({
                limit,
                cursor,
                filter,
                with: {
                    analytics_data: true,
                    financial_data: true,
                },
            });
            const postings = orders?.postings || [];
            all.push(...postings.map((order) => ({ ...order, isFbo: true })));

            // Тот же курсор в ответе = страница не сдвинулась, выходим, иначе вечный цикл.
            const nextCursor = orders?.cursor || '';
            hasMore = Boolean(orders?.has_next) && nextCursor !== '' && nextCursor !== cursor;
            cursor = nextCursor;
        }
        return all;
    }

    /**
     * IFboSales: доставленные покупателю FBO-отправления за окно по дате создания.
     * Журнал здесь не пишем — им владеет наблюдатель (`ingestDelivered`: по записи
     * он отличает новое событие от уже виденного).
     */
    async listDeliveredFbo(): Promise<string[]> {
        const postings = await this.fetch('delivered', PostingFboService.DELIVERED_WINDOW_DAYS);
        return postings.map((p) => p.posting_number);
    }

    /**
     * Окно доставленных FBO. Фильтр у FBO только по дате создания, окно читается целиком
     * каждый прогон: 60 дней на опте — ~450 отправлений, 5 страниц (обмерено 05.10.2026).
     * Холодный старт этим же окном подбирает продажи, по которым код не выведен.
     */
    private static readonly DELIVERED_WINDOW_DAYS = 60;

    /** Нахлёст окна при отсчёте от журнала. */
    private static readonly OVERLAP_DAYS = 1;
    async listCanceled(): Promise<PostingDto[]> {
        return this.list('cancelled', 90);
    }
    async listAwaitingDelivering(): Promise<PostingDto[]> {
        return this.list('awaiting_deliver');
    }
    async listAwaitingPackaging(): Promise<PostingDto[]> {
        return this.list('awaiting_packaging');
    }

    async getByPostingNumber(_postingNumber: string): Promise<PostingDto> {
        return Promise.resolve(undefined);
    }

    /**
     * IFboReconcilable: отправления, уже собранные и уехавшие, за окно по дате СОЗДАНИЯ заказа.
     *
     * Отдельно от `list()` намеренно: та пишет журнал `MP_EVENT` (по нему считается её окно) —
     * сверке это не нужно, а на широком окне дало бы тысячи записей в сутки.
     */
    async listShippedSince(since: Date): Promise<Map<string, string>> {
        const shipped = new Map<string, string>();
        const to = DateTime.now().endOf('day').toJSDate();
        for (const status of PostingFboService.SHIPPED_STATUSES) {
            let cursor = '';
            let hasMore = true;
            while (hasMore) {
                const orders = await this.productService.orderFboList({
                    limit: 100,
                    cursor,
                    filter: { since, to, statuses: [status] },
                    with: { analytics_data: false },
                });
                for (const posting of orders?.postings ?? []) {
                    shipped.set(posting.posting_number, posting.status ?? status);
                }
                const nextCursor = orders?.cursor || '';
                hasMore = Boolean(orders?.has_next) && nextCursor !== '' && nextCursor !== cursor;
                cursor = nextCursor;
            }
        }
        return shipped;
    }

    /**
     * «Озон собрал и повёз» — всё после сборки. Решение владельца 19.08.2026:
     * критерий подбора — не «доставлено», а «уехало»; ждать конца доставки нельзя,
     * счёт должен быть подобран в тот же день.
     */
    private static readonly SHIPPED_STATUSES = ['awaiting_deliver', 'delivering', 'delivered'];

    getBuyerId(): number {
        return this.configService.get<number>('OZON_BUYER_ID', 24416);
    }
}
