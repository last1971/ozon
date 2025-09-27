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
    constructor(
        private readonly api: AvitoApiService,
        @Inject(GOOD_SERVICE) private readonly goodService: IGood,
        private readonly configService: ConfigService
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
        const avitoIds = await this.goodService.getAllAvitoIds();
        const goods = new Map<string, number>();

        if (avitoIds.length === 0) {
            return { goods, nextArgs: null };
        }

        const chunks = chunk(avitoIds.map(id => parseInt(id)), 100);

        for (const chunkIds of chunks) {
            const stockResponse = await this.getStock(chunkIds);
            stockResponse.stocks.forEach(stock => {
                if (!stock.is_out_of_stock) {
                    const quantity = stock.is_unlimited ? 999999 : stock.quantity;
                    goods.set(stock.item_id.toString(), quantity);
                }
            });
        }

        return { goods, nextArgs: null };
    }

    // Push stock levels to Avito for provided goods map (offer_id -> amount)
    async updateGoodCounts(goods: Map<string, number>): Promise<number> {
        // TODO: call Avito stock update endpoint, batching as needed
        // Placeholder: pretend nothing updated yet
        return 0;
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

    async getStock(item_ids: number[], strong_consistency = true): Promise<{ stocks: Array<{ item_id: number; quantity: number; is_out_of_stock: boolean; is_unlimited: boolean; is_multiple: boolean }> }> {
        return this.api.request(
            `/core/v1/accounts/self/items/stock`,
            { item_ids, strong_consistency },
            'post'
        );
    }
}
