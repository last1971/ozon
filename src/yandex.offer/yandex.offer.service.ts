import { Injectable, OnModuleInit } from '@nestjs/common';
import { AbstractOfferService } from './abstract.offer.service';
import { Environment } from '../env.validation';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ProductInfoDto } from 'src/product/dto/product.info.dto';

@Injectable()
export class YandexOfferService extends AbstractOfferService implements OnModuleInit {
    infoList(offer_id: string[]): Promise<ProductInfoDto[]> {
        throw new Error('Method not implemented.');
    }
    async onModuleInit(): Promise<any> {
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (!services.includes(GoodServiceEnum.YANDEX)) {
            return;
        }
        const yandex = await this.vaultService.get('yandex-seller');
        this.campaignId = parseInt(yandex['electronica-company'] as string);
        this.warehouseId = parseInt(yandex['electronica-fbs-tomsk'] as string);
        await this.loadSkuList(this.configService.get<Environment>('NODE_ENV') === 'production');
    }
}
