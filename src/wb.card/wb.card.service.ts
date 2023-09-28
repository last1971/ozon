import { Injectable, OnModuleInit } from '@nestjs/common';
import { GoodCountsDto, ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { WbApiService } from '../wb.api/wb.api.service';
import { head } from 'lodash';
import { VaultService } from 'vault-module/lib/vault.service';

@Injectable()
export class WbCardService implements ICountUpdateable, OnModuleInit {
    private warehouseId: number;
    constructor(
        private api: WbApiService,
        private vault: VaultService,
    ) {}
    async onModuleInit(): Promise<any> {
        const wb = await this.vault.get('wildberries');
        this.warehouseId = wb.WAREHOSE_ID as number;
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
        const skus = new Map<string, string>();
        res.data.cards.forEach((card) => {
            const barcode = head(card.sizes.skus);
            skus.set(barcode, card.vendorCode);
        });
        const quantities = await this.api.method('/api/v3/stocks/' + this.warehouseId, 'post', {
            skus: Array.from(skus.keys()),
        });
        const goods = new Map<string, number>();
        quantities.stocks.forEach((stock) => {
            const sku = skus.get(stock.sku);
            goods.set(sku, stock.amount);
        });
        return {
            goods,
            nextArgs: {},
        };
    }

    updateGoodCounts(goods: Map<string, number>): Promise<number> {
        return Promise.resolve(0);
    }
}
