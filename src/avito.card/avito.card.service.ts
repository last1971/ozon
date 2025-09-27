import { Injectable } from '@nestjs/common';
import { ICountUpdateable, GoodCountsDto } from '../interfaces/ICountUpdatebale';
import { IProductable } from '../interfaces/i.productable';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { AvitoApiService } from '../avito.api/avito.api.service';

@Injectable()
export class AvitoCardService extends ICountUpdateable implements IProductable {
    constructor(private readonly api: AvitoApiService) {
        super();
    }

    // Load and map SKUs to Avito item IDs; return nextArgs for pagination if applicable
    async getGoodIds(args: any): Promise<GoodCountsDto<number>> {
        // TODO: integrate with Avito endpoint that lists items and stock info
        // Placeholder returns empty set with no pagination
        return { goods: new Map<string, number>(), nextArgs: null };
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
}
