import { Injectable, Logger } from '@nestjs/common';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { ProductService } from '../product/product.service';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { FirebirdTransaction } from 'ts-firebird';
// import { Cron } from '@nestjs/schedule';
import { isMarkCodesEnabled } from '../helpers';
import { OZON_ORDER_CANCELLATION_SUFFIX } from '../helpers/order.cancellation.constants';
import { GoodServiceEnum } from '../good/good.service.enum';
import { FboInvoiceCreatorService } from './fbo-invoice-creator.service';
import { MpEventService } from '../mp-event/mp-event.service';

@Injectable()
export class PostingFboService implements IOrderable {
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
        const suffix = OZON_ORDER_CANCELLATION_SUFFIX.FBO.trim();
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

    async getByPostingNumber(postingNumber: string): Promise<PostingDto> {
        return Promise.resolve(undefined);
    }

    getBuyerId(): number {
        return this.configService.get<number>('OZON_BUYER_ID', 24416);
    }
}
