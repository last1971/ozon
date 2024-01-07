import { flatten, Injectable, OnModuleInit } from '@nestjs/common';
import { GoodCountsDto, ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { WbApiService } from '../wb.api/wb.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { barCodeSkuPairs } from '../helpers';
import { WbCardDto } from './dto/wb.card.dto';
import { chunk } from 'lodash';
import { Environment } from '../env.validation';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WbCardService extends ICountUpdateable implements OnModuleInit {
    private warehouseId: number;
    constructor(
        private api: WbApiService,
        private vault: VaultService,
        private configService: ConfigService,
    ) {
        super();
    }
    async onModuleInit(): Promise<any> {
        const wb = await this.vault.get('wildberries');
        this.warehouseId = wb.WAREHOUSE_ID as number;
        await this.loadSkuList(this.configService.get<Environment>('NODE_ENV') === 'production');
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
        const parts = await Promise.all(
            chunk(Array.from(goods.keys()), 100).map((codes) =>
                this.api.method('/content/v1/cards/filter', 'post', {
                    vendorCodes: codes,
                }),
            ),
        );
        const data = flatten(parts.map((part) => part.data));
        const skus = new Map<string, string>();
        [...barCodeSkuPairs(data)].forEach((barCode) => {
            skus.set(barCode[1], barCode[0]);
        });
        const stocks = [...goods]
            .filter((good) => skus.get(good[0]))
            .map((good) => ({
                sku: skus.get(good[0]),
                amount: good[1],
            }));
        if (stocks && stocks.length) {
            await this.api.method('/api/v3/stocks/' + this.warehouseId, 'put', { stocks });
            return stocks.length;
        }
        return 0;
    }

    async getCardsByVendorCodes(vendorChunkCodes: string[]): Promise<WbCardDto[]> {
        const res = await Promise.all(
            chunk(vendorChunkCodes, 100).map((vendorCodes) =>
                this.api.method('/content/v1/cards/filter', 'post', { vendorCodes }),
            ),
        );
        return res.map((data) => data.data).flat();
    }
}
