import { Injectable, OnModuleInit } from '@nestjs/common';
import { GoodCountsDto, ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { WbApiService } from '../wb.api/wb.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { barCodeSkuPairs } from '../helpers';

@Injectable()
export class WbCardService implements ICountUpdateable, OnModuleInit {
    private warehouseId: number;
    constructor(
        private api: WbApiService,
        private vault: VaultService,
    ) {}
    async onModuleInit(): Promise<any> {
        const wb = await this.vault.get('wildberries');
        this.warehouseId = wb.WAREHOUSE_ID as number;
    }
    async getGoodIds(args: any): Promise<GoodCountsDto<number>> {
        const res = await this.api.method(
            '/content/v1/cards/cursor/list',
            'post',
            args
                ? args
                : {
                      sort: {
                          cursor: {
                              limit: 1000,
                          },
                          filter: {
                              withPhoto: -1,
                          },
                      },
                  },
        );
        const { cards, cursor } = res.data;
        const barcodes = barCodeSkuPairs(cards);
        const quantities = await this.api.method('/api/v3/stocks/' + this.warehouseId, 'post', {
            skus: Array.from(barcodes.keys()),
        });
        const goods = new Map<string, number>();
        quantities.stocks.forEach((stock) => {
            const sku = barcodes.get(stock.sku);
            goods.set(sku, stock.amount);
        });
        const { updatedAt, nmID, total } = cursor;
        return {
            goods,
            nextArgs:
                total < 1000
                    ? null
                    : {
                          sort: {
                              cursor: {
                                  limit: 1000,
                                  updatedAt,
                                  nmID,
                              },
                              filter: {
                                  withPhoto: -1,
                              },
                          },
                      },
        };
    }

    async updateGoodCounts(goods: Map<string, number>): Promise<number> {
        const res = await this.api.method('/content/v1/cards/filter', 'post', {
            vendorCodes: Array.from(goods.keys()),
        });
        const skus = new Map<string, string>();
        [...barCodeSkuPairs(res.data)].forEach((barCode) => {
            skus.set(barCode[1], barCode[0]);
        });
        const stocks = [...goods]
            .filter((good) => skus.get(good[0]))
            .map((good) => ({
                sku: skus.get(good[0]),
                amount: good[1],
            }));
        return (await this.api.method('/api/v3/stocks/' + this.warehouseId, 'put', { stocks }))
            ? 0
            : [...stocks].length;
    }
}
