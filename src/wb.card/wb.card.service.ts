import { Injectable, OnModuleInit } from '@nestjs/common';
import { GoodCountsDto, ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { WbApiService } from '../wb.api/wb.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { barCodeSkuPairs } from '../helpers';
import { WbCardDto } from './dto/wb.card.dto';
import { Environment } from '../env.validation';
import { ConfigService } from '@nestjs/config';
import { WbCardAnswerDto } from './dto/wb.card.answer.dto';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ProductInfoDto } from "../product/dto/product.info.dto";
import { IProductable } from '../interfaces/i.productable';

@Injectable()
export class WbCardService extends ICountUpdateable implements OnModuleInit, IProductable {
    private warehouseId: number;
    private skuBarcodePair: Map<string, string>;
    private skuNmIDPair: Map<string, string>;
    private productInfos: Map<string, ProductInfoDto>;
    constructor(
        private api: WbApiService,
        private vault: VaultService,
        private configService: ConfigService,
    ) {
        super();
        this.skuBarcodePair = new Map<string, string>();
        this.skuNmIDPair = new Map<string, string>();
        this.productInfos = new Map<string, ProductInfoDto>();
    }
    async onModuleInit(): Promise<any> {
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (!services.includes(GoodServiceEnum.WB)) {
            return;
        }
        const wb = await this.vault.get('wildberries');
        this.warehouseId = wb.WAREHOUSE_ID as number;
        await this.loadSkuList(this.configService.get<Environment>('NODE_ENV') === 'production');
    }

    public getNmID(sku: string): string {
        return this.skuNmIDPair.get(sku);
    }

    public wbCardToProductInfo(card: WbCardDto): ProductInfoDto {
        return {
            barCode: card.sizes[0].skus[0],
            goodService: GoodServiceEnum.WB,
            id: card.nmID.toString(),
            primaryImage: card.photos[0].big,
            remark: card.title,
            sku: card.vendorCode,
            fbsCount: 0,
            fboCount: 0,
        }
    }

    async getWbCards(args: any): Promise<WbCardAnswerDto> {
        const res: WbCardAnswerDto = await this.api.method(
            'https://content-api.wildberries.ru/content/v2/get/cards/list',
            'post',
            args
                ? args
                : {
                      settings: {
                          cursor: {
                              limit: 100,
                          },
                          filter: {
                              withPhoto: -1,
                          },
                      },
                  },
            true,
        );
        res.cards.forEach((card) => {
            this.productInfos.set(card.vendorCode, this.wbCardToProductInfo(card));
        });
        return res;
    }
    async getAllWbCards(): Promise<WbCardDto[]> {
        const ret: WbCardDto[] = [];
        let cycle = true;
        let args: any = null;
        while (cycle) {
            const { cards, cursor } = await this.getWbCards(args);
            ret.push(...cards);
            const { updatedAt, nmID, total } = cursor;
            args = {
                limit: 100,
                updatedAt,
                nmID,
            };
            cycle = total === 100;
        }
        return ret;
    }
    async getGoodIds(args: any): Promise<GoodCountsDto<number>> {
        const res = await this.getWbCards(args);
        const { cards, cursor } = res;
        const barcodes = barCodeSkuPairs(cards);
        for (const [key, value] of barcodes) {
            this.skuBarcodePair.set(value, key);
        }
        cards.forEach((card) => {
            this.skuNmIDPair.set(card.vendorCode, card.nmID.toString());
        });
        const quantities = await this.api.method(
            '/api/v3/stocks/' + this.warehouseId,
            'post',
            { skus: Array.from(barcodes.keys()) },
        );
        const goods = new Map<string, number>();
        if (quantities?.stocks) {
            quantities.stocks.forEach((stock) => {
                const sku = barcodes.get(stock.sku);
                goods.set(sku, stock.amount);
            });
        }
        const { updatedAt, nmID, total } = cursor;
        return {
            goods,
            nextArgs:
                total < 100
                    ? null
                    : {
                          settings: {
                              cursor: {
                                  limit: 100,
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
        const stocks = [...goods]
            .filter((good) => this.skuBarcodePair.get(good[0]))
            .map((good) => ({
                sku: this.skuBarcodePair.get(good[0]),
                amount: good[1],
            }));
        if (stocks && stocks.length) {
            await this.api.method('/api/v3/stocks/' + this.warehouseId, 'put', { stocks });
            return stocks.length;
        }
        return 0;
    }

    async infoList(offer_id: string[]): Promise<ProductInfoDto[]> {
        return offer_id.map((id) => this.productInfos.get(id));
    }
}
