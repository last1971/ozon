import { Injectable } from '@nestjs/common';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { StockDto } from './dto/stock.dto';
import { ResultDto } from '../helpers/result.dto';
import { GetCampaignOffersResultDto } from './dto/get.campaign.offers.result.dto';
import { GoodsStatsDto } from './dto/goods.stats.dto';
import { GoodCountsDto, ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { VaultService } from 'vault-module/lib/vault.service';
import { GoodsStatsWarehouseStockType } from './dto/goods.stats.warehouse.stock.dto';
import { StockType } from './dto/stock.item.dto';

@Injectable()
export class YandexOfferService implements ICountUpdateable {
    constructor(private yandexApi: YandexApiService, private vaultService: VaultService) {}
    async updateCount(campaignId: number, skus: StockDto[]): Promise<ResultDto> {
        await this.yandexApi.method(`campaigns/${campaignId}/offers/stocks`, 'put', { skus });
        return { isSuccess: true };
    }
    async index(campaignId: number, page_token = '', limit = 100): Promise<GetCampaignOffersResultDto> {
        const res = await this.yandexApi.method(
            `campaigns/${campaignId}/offers?limit=${limit}&page_token=${page_token}`,
            'post',
            {
                statuses: ['PUBLISHED', 'NO_STOCKS', 'CHECKING'],
            },
        );
        return res.result;
    }
    async getSkus(campaignId: number, shopSkus: string[]): Promise<GoodsStatsDto> {
        const res = await this.yandexApi.method(`campaigns/${campaignId}/stats/skus`, 'post', { shopSkus });
        return res.result;
    }

    async getGoodIds(args: any): Promise<GoodCountsDto> {
        const yandex = await this.vaultService.get('yandex-seller');
        const campaignId = yandex['electronica-company'] as number;
        const fbs = parseInt(yandex['electronica-fbs-tomsk'] as string);
        const offersData: GetCampaignOffersResultDto = await this.index(campaignId, args);
        const skus = offersData.offers.map((offer) => offer.offerId);
        const leftoversData = await this.getSkus(campaignId, skus);
        return {
            goods: new Map(
                leftoversData.shopSkus.map((shopSku) => {
                    const warehouse = shopSku.warehouses
                        ? shopSku.warehouses.find((warehouse) => warehouse.id === fbs)
                        : null;
                    const stock = warehouse?.stocks.find(
                        (stock) => stock.type === GoodsStatsWarehouseStockType.AVAILABLE,
                    );

                    return [shopSku.shopSku, stock?.count || 0];
                }),
            ),
            nextArgs: offersData.paging.nextPageToken,
        };
    }

    async updateGoodCounts(goods: Map<string, number>): Promise<number> {
        const yandex = await this.vaultService.get('yandex-seller');
        const campaignId = yandex['electronica-company'] as number;
        const fbs = parseInt(yandex['electronica-fbs-tomsk'] as string);
        const updateGoods: StockDto[] = [];
        goods.forEach((count, sku) => {
            updateGoods.push({
                sku,
                warehouseId: fbs,
                items: [
                    {
                        type: StockType.FIT,
                        count,
                        updatedAt: new Date(),
                    },
                ],
            });
        });
        await this.updateCount(campaignId, updateGoods);
        return updateGoods.length;
    }
}
