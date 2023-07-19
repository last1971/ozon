import { GoodCountsDto, ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { Injectable } from '@nestjs/common';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { StockDto } from './dto/stock.dto';
import { ResultDto } from '../helpers/result.dto';
import { GetCampaignOffersResultDto } from './dto/get.campaign.offers.result.dto';
import { GoodsStatsDto } from './dto/goods.stats.dto';
import { GoodsStatsWarehouseStockType } from './dto/goods.stats.warehouse.stock.dto';
import { StockType } from './dto/stock.item.dto';

@Injectable()
export abstract class AbstractOfferService implements ICountUpdateable {
    protected campaignId: number;
    protected warehouseId: number;
    constructor(private yandexApi: YandexApiService, protected vaultService: VaultService) {}
    async updateCount(skus: StockDto[]): Promise<ResultDto> {
        await this.yandexApi.method(`campaigns/${this.campaignId}/offers/stocks`, 'put', { skus });
        return { isSuccess: true };
    }
    async index(page_token = '', limit = 100): Promise<GetCampaignOffersResultDto> {
        const res = await this.yandexApi.method(
            `campaigns/${this.campaignId}/offers?limit=${limit}&page_token=${page_token}`,
            'post',
            {
                statuses: ['PUBLISHED', 'NO_STOCKS', 'CHECKING'],
            },
        );
        return res.result;
    }
    async getSkus(shopSkus: string[]): Promise<GoodsStatsDto> {
        const res = await this.yandexApi.method(`campaigns/${this.campaignId}/stats/skus`, 'post', { shopSkus });
        return res.result;
    }

    async getGoodIds(args: any): Promise<GoodCountsDto> {
        const offersData: GetCampaignOffersResultDto = await this.index(args);
        const skus = offersData.offers.map((offer) => offer.offerId);
        const leftoversData = await this.getSkus(skus);
        return {
            goods: new Map(
                leftoversData.shopSkus.map((shopSku) => {
                    const warehouse = shopSku.warehouses
                        ? shopSku.warehouses.find((warehouse) => warehouse.id === this.warehouseId)
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
        const updateGoods: StockDto[] = [];
        goods.forEach((count, sku) => {
            updateGoods.push({
                sku,
                warehouseId: this.warehouseId,
                items: [
                    {
                        type: StockType.FIT,
                        count,
                        updatedAt: new Date(),
                    },
                ],
            });
        });
        await this.updateCount(updateGoods);
        return updateGoods.length;
    }
}
