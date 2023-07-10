import { Injectable } from '@nestjs/common';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { StockDto } from './dto/stock.dto';
import { ResultDto } from '../helpers/result.dto';
import { GetCampaignOffersResultDto } from './dto/get.campaign.offers.result.dto';

@Injectable()
export class YandexOfferService {
    constructor(private yandexApi: YandexApiService) {}
    async updateCount(campaignId: number, skus: StockDto[]): Promise<ResultDto> {
        await this.yandexApi.method(`campaigns/${campaignId}/offers/stocks`, 'put', { skus });
        return { isSuccess: true };
    }
    async getSkus(campaignId: number, page_token = '', limit = 100): Promise<GetCampaignOffersResultDto> {
        const res = await this.yandexApi.method(
            `campaigns/${campaignId}/offers?limit=${limit}&page_token=${page_token}`,
            'post',
            {
                statuses: ['PUBLISHED'],
            },
        );
        return res.result;
    }
}
