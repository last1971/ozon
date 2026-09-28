import { Injectable, OnModuleInit } from '@nestjs/common';
import { chunk } from 'lodash';
import { AbstractOfferService } from './abstract.offer.service';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ProductInfoDto } from 'src/product/dto/product.info.dto';

@Injectable()
export class YandexOfferService extends AbstractOfferService implements OnModuleInit {
    private businessId: string;

    /**
     * Карточки по артикулам (название, ШК, картинка) — для грида «FBS этикетки» и
     * позиций поставки. Источник — offer-mappings бизнеса (до 200 артикулов за запрос).
     * Остатков тут нет: у Яндекса они отдельным методом, гриду они не нужны.
     */
    async infoList(offer_id: string[]): Promise<ProductInfoDto[]> {
        const result: ProductInfoDto[] = [];
        for (const offerIds of chunk(offer_id, 200)) {
            const res = await this.yandexApi.method(`businesses/${this.businessId}/offer-mappings`, 'post', {
                offerIds,
            });
            const mappings: any[] = res?.result?.offerMappings ?? [];
            for (const m of mappings) {
                const offer = m.offer ?? {};
                if (!offer.offerId) continue;
                result.push({
                    sku: String(offer.offerId),
                    barCode: offer.barcodes?.[0] ?? '',
                    remark: offer.name ?? '',
                    primaryImage: offer.pictures?.[0],
                    id: String(m.mapping?.marketSku ?? offer.offerId),
                    goodService: GoodServiceEnum.YANDEX,
                    fbsCount: 0,
                    fboCount: 0,
                });
            }
        }
        return result;
    }
    async onModuleInit(): Promise<any> {
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (!services.includes(GoodServiceEnum.YANDEX)) {
            return;
        }
        const yandex = await this.vaultService.get('yandex-seller');
        this.campaignId = parseInt(yandex['electronica-company'] as string);
        this.warehouseId = parseInt(yandex['electronica-fbs-tomsk'] as string);
        this.businessId = yandex['electronica-business'] as string;
    }
}
