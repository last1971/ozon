import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ICountUpdateable, GoodCountsDto } from '../interfaces/ICountUpdatebale';
import { IProductable } from '../interfaces/i.productable';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { AvitoApiService } from '../avito.api/avito.api.service';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { chunk } from 'lodash';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';
import { Environment } from '../env.validation';

@Injectable()
export class AvitoCardService extends ICountUpdateable implements IProductable, OnModuleInit {
    private skuAvitoIdPair: Map<string, string> = new Map<string, string>();
    constructor(
        private readonly api: AvitoApiService,
        @Inject(GOOD_SERVICE) private readonly goodService: IGood,
        private readonly configService: ConfigService,
    ) {
        super();
    }

    async onModuleInit(): Promise<void> {
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (!services.includes(GoodServiceEnum.AVITO)) {
            return;
        }
        await this.loadSkuList(this.configService.get<Environment>('NODE_ENV') === 'production');
    }

    // Load and map SKUs to Avito item IDs; return nextArgs for pagination if applicable
    async getGoodIds(args: any): Promise<GoodCountsDto<number>> {
        const avitoGoods = await this.goodService.getAllAvitoGoods();
        const goods = new Map<string, number>();

        if (avitoGoods.length === 0) {
            return { goods, nextArgs: null };
        }

        const chunks = chunk(
            avitoGoods.map((avito) => parseInt(avito.id)),
            100,
        );

        for (const chunkIds of chunks) {
            const stockResponse = await this.getStock(chunkIds);
            stockResponse.stocks.forEach((stock) => {
                const quantity = stock.is_unlimited ? 999999 : stock.quantity;
                const avito = avitoGoods.find((avito) => avito.id === stock.item_id.toString());
                const sku = `${avito.goodsCode}${avito.coeff === 1 ? '' : '-' + avito.coeff}`;
                this.skuAvitoIdPair.set(sku, avito.id);
                goods.set(sku, quantity);
            });
        }

        return { goods, nextArgs: null };
    }

    // Push stock levels to Avito for provided goods map (offer_id -> amount)
    async updateGoodCounts(goods: Map<string, number>): Promise<number> {
        if (goods.size === 0) return 0;

        const stocks = Array.from(goods.entries())
            .map(([sku, quantity]) => ({
                item_id: parseInt(this.skuAvitoIdPair.get(sku)),
                quantity: Math.min(quantity, 999999),
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
                console.error('Failed to update Avito stocks:', error);
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
        stocks: Array<{
            item_id: number;
            quantity: number;
            is_out_of_stock: boolean;
            is_unlimited: boolean;
            is_multiple: boolean;
        }>;
    }> {
        return this.api.request(`/stock-management/1/info`, { item_ids, strong_consistency }, 'post');
    }
}
