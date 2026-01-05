import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICountUpdateable, GoodCountsDto } from '../interfaces/ICountUpdatebale';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { SyliusApiService } from './sylius.api.service';
import { GoodServiceEnum } from '../good/good.service.enum';
import { Environment } from '../env.validation';

interface SyliusVariant {
    code: string;
    onHand: number;
    onHold: number;
}

interface SyliusVariantsResponse {
    'hydra:member': SyliusVariant[];
    'hydra:totalItems': number;
}

interface SyliusStockUpdateResponse {
    updated: number;
}

@Injectable()
export class SyliusProductService extends ICountUpdateable implements OnModuleInit {
    constructor(
        private readonly api: SyliusApiService,
        private readonly configService: ConfigService,
    ) {
        super();
    }

    async onModuleInit(): Promise<void> {
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (!services.includes(GoodServiceEnum.SYLIUS)) {
            return;
        }
        await this.loadSkuList(this.configService.get<Environment>('NODE_ENV') === 'production');
    }

    async getGoodIds(args: any): Promise<GoodCountsDto<number>> {
        const page = args?.page || 1;
        const itemsPerPage = 100;
        const goods = new Map<string, number>();

        const response = await this.api.method<SyliusVariantsResponse>(
            '/api/v2/admin/product-variants',
            'get',
            { itemsPerPage, page },
        );

        const variants = response['hydra:member'] || [];
        for (const variant of variants) {
            if (/^\d+$/.test(variant.code)) {
                goods.set(variant.code, variant.onHand);
            }
        }

        const totalItems = response['hydra:totalItems'] || 0;
        const hasNextPage = page * itemsPerPage < totalItems;

        return {
            goods,
            nextArgs: hasNextPage ? { page: page + 1 } : null,
        };
    }

    async updateGoodCounts(goods: Map<string, number>): Promise<number> {
        if (goods.size === 0) return 0;

        const goodsObj: Record<string, number> = {};
        for (const [code, quantity] of goods) {
            goodsObj[code] = quantity;
        }

        const response = await this.api.method<SyliusStockUpdateResponse>(
            '/api/v2/admin/stock/update',
            'post',
            { goods: goodsObj },
        );

        return response.updated || 0;
    }

    async infoList(offer_id: string[]): Promise<ProductInfoDto[]> {
        return offer_id.map((id) => ({
            barCode: '',
            goodService: GoodServiceEnum.SYLIUS,
            id,
            primaryImage: '',
            remark: '',
            sku: id,
            fbsCount: 0,
            fboCount: 0,
        }));
    }
}
