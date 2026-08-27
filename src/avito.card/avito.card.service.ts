import { Injectable, Inject, Logger } from '@nestjs/common';
import { ICountUpdateable, GoodCountsDto } from '../interfaces/ICountUpdatebale';
import { IProductable } from '../interfaces/i.productable';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { AvitoApiService } from '../avito.api/avito.api.service';
import { AvitoLinkMaintenanceService } from './avito.link.maintenance.service';
import { AVITO_GOOD_STORE, IAvitoGoodStore } from '../interfaces/i.avito.good.store';
import { GoodAvitoDto } from '../good/dto/good.avito.dto';
import { avitoSku, AVITO_MAX_QUANTITY } from './avito.sku';
import { chunk } from 'lodash';
import { ConfigService } from '@nestjs/config';

/** Размер пачки для /stock-management/1/info. */
const STOCK_CHUNK = 10;
/**
 * Доля необъяснённых провалов, выше которой прогон считается аварией.
 * Ноль = прежнее поведение: любая позиция, пропавшая из выгрузки не из-за удаления объявления,
 * роняет прогон, ExtraGoodService отключает сервис и шлёт письмо.
 */
const DEFAULT_FAIL_RATIO = 0;

interface AvitoStock {
    item_id: number;
    quantity: number;
    is_out_of_stock: boolean;
    is_unlimited: boolean;
    is_multiple: boolean;
}

@Injectable()
export class AvitoCardService extends ICountUpdateable implements IProductable {
    private readonly logger = new Logger(AvitoCardService.name);
    private skuAvitoIdPair: Map<string, string> = new Map<string, string>();
    constructor(
        private readonly api: AvitoApiService,
        @Inject(AVITO_GOOD_STORE) private readonly store: IAvitoGoodStore,
        private readonly configService: ConfigService,
        private readonly maintenance: AvitoLinkMaintenanceService,
    ) {
        super();
    }

    // Load and map SKUs to Avito item IDs; return nextArgs for pagination if applicable
    async getGoodIds(args: any): Promise<GoodCountsDto<number>> {
        const avitoGoods = await this.store.getAllAvitoGoods();
        const goods = new Map<string, number>();

        if (avitoGoods.length === 0) {
            return { goods, nextArgs: null };
        }

        const byId = new Map(avitoGoods.map((avito) => [avito.id, avito]));
        const askable = avitoGoods.filter((avito) => {
            if (Number.isNaN(this.toItemId(avito))) {
                this.logger.warn(`Авито: нечисловой item_id «${avito.id}» — пропущен`);
                return false;
            }
            return true;
        });
        if (askable.length === 0) {
            // Справочник не пуст, а спросить нечего — это поломка данных, а не «нет товара».
            throw new Error(`Авито: ни один из ${avitoGoods.length} item_id не пригоден для запроса`);
        }

        // Мапа собирается в стороне и подменяется целиком: пока идёт прогон (десятки запросов),
        // цены продолжают видеть прежние пары sku↔id, а протухшие пары не переживают прогон.
        const pairs = new Map<string, string>();
        const failed: GoodAvitoDto[] = [];
        for (const part of chunk(askable, STOCK_CHUNK)) {
            let stocks: AvitoStock[];
            try {
                stocks = (await this.getStock(part.map((avito) => this.toItemId(avito)))).stocks;
            } catch {
                // Один мёртвый item_id отдаёт 400 на всю пачку — перебираем поштучно,
                // чтобы не потерять остальные девять позиций.
                const retried = await this.retryOneByOne(part);
                stocks = retried.stocks;
                failed.push(...retried.failed);
            }
            this.collectStocks(stocks, byId, goods, pairs);
        }
        this.skuAvitoIdPair = pairs;

        if (failed.length > 0) {
            const disabled = await this.maintenance.disableDeadLinks(failed);
            // Объяснённые (объявление удалено) провалы — норма, они и лечатся отключением привязки.
            // Всё остальное — позиция просто выпала из выгрузки, и её остаток замрёт: это авария.
            const unexplained = failed.filter((avito) => !disabled.includes(avito.id));
            if (unexplained.length > 0) {
                this.assertFailureRatio(unexplained, askable.length);
            }
        }

        return { goods, nextArgs: null };
    }

    /** Единственное место, где id привязки (VARCHAR в базе) превращается в item_id для API. */
    private toItemId(avito: Pick<GoodAvitoDto, 'id'>): number {
        return parseInt(avito.id);
    }

    private collectStocks(
        stocks: AvitoStock[],
        byId: Map<string, GoodAvitoDto>,
        goods: Map<string, number>,
        pairs: Map<string, string>,
    ): void {
        stocks.forEach((stock) => {
            const quantity = stock.is_unlimited ? AVITO_MAX_QUANTITY : stock.quantity;
            const avito = byId.get(stock.item_id.toString());
            if (!avito) return;
            const sku = avitoSku(avito);
            pairs.set(sku, avito.id);
            goods.set(sku, quantity);
        });
    }

    /** Разбор упавшей пачки: живые позиции забираем, неответившие возвращаем списком. */
    private async retryOneByOne(part: GoodAvitoDto[]): Promise<{ stocks: AvitoStock[]; failed: GoodAvitoDto[] }> {
        const stocks: AvitoStock[] = [];
        const failed: GoodAvitoDto[] = [];
        for (const avito of part) {
            try {
                const response = await this.getStock([this.toItemId(avito)]);
                stocks.push(...response.stocks);
            } catch {
                failed.push(avito);
            }
        }
        return { stocks, failed };
    }

    /**
     * Необъяснённый провал = позиция выпала из выгрузки, её остаток замрёт до следующего прогона.
     * По умолчанию (порог 0) это авария: сервис отключается и уходит письмо, как было до правки.
     * AVITO_FAIL_RATIO позволяет сознательно ослабить порог; мусорные значения игнорируются.
     */
    private assertFailureRatio(unexplained: GoodAvitoDto[], total: number): void {
        const configured = Number(this.configService.get('AVITO_FAIL_RATIO'));
        const limit = Number.isFinite(configured) && configured > 0 && configured < 1 ? configured : DEFAULT_FAIL_RATIO;
        const ids = unexplained.map((avito) => avito.id).join(', ');
        if (unexplained.length / total > limit) {
            throw new Error(
                `Авито: остаток не получен по ${unexplained.length} из ${total} объявлений (${ids}) — прогон не засчитан`,
            );
        }
        this.logger.warn(`Авито: остаток не получен по ${unexplained.length} из ${total} объявлений (${ids})`);
    }

    // Push stock levels to Avito for provided goods map (offer_id -> amount)
    async updateGoodCounts(goods: Map<string, number>): Promise<number> {
        if (goods.size === 0) return 0;

        const stocks = Array.from(goods.entries())
            .map(([sku, quantity]) => ({
                item_id: this.toItemId({ id: this.skuAvitoIdPair.get(sku) ?? '' }),
                quantity: Math.min(quantity, AVITO_MAX_QUANTITY),
            }))
            .filter((stock) => !isNaN(stock.item_id));

        if (stocks.length === 0) return 0;

        const chunks = chunk(stocks, 200);
        let updatedCount = 0;

        for (const stockChunk of chunks) {
            try {
                const response = await this.api.request<{
                    stocks: Array<{
                        errors: string[];
                        external_id?: string;
                        item_id: number;
                        success: boolean;
                    }>;
                }>('/stock-management/1/stocks', { stocks: stockChunk }, 'put');
                updatedCount += response.stocks.filter((r) => r.success).length;
            } catch (error) {
                this.logger.error(`Не удалось обновить остатки на Авито: ${(error as Error).message}`);
            }
        }

        return updatedCount;
    }

    public getAvitoId(sku: string): string | undefined {
        return this.skuAvitoIdPair.get(sku);
    }

    async infoList(offer_id: string[]): Promise<ProductInfoDto[]> {
        // TODO: fetch info for given SKUs from Avito (if needed by UI)
        return offer_id.map((id) => ({
            barCode: '',
            goodService: null as any,
            id,
            primaryImage: '',
            remark: '',
            sku: id,
            fbsCount: 0,
            fboCount: 0,
        }));
    }

    async getStock(
        item_ids: number[],
        strong_consistency = true,
    ): Promise<{
        stocks: AvitoStock[];
    }> {
        return this.api.request(`/stock-management/1/info`, { item_ids, strong_consistency }, 'post');
    }
}
