import { Injectable, OnModuleInit } from '@nestjs/common';
import { AbstractOfferService } from './abstract.offer.service';
import { Environment } from '../env.validation';
import { GoodServiceEnum } from '../good/good.service.enum';

@Injectable()
export class YandexOfferService extends AbstractOfferService implements OnModuleInit {
    async onModuleInit(): Promise<any> {
        const yandex = await this.vaultService.get('yandex-seller');
        this.campaignId = parseInt(yandex['electronica-company'] as string);
        this.warehouseId = parseInt(yandex['electronica-fbs-tomsk'] as string);
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        await this.loadSkuList(
            this.configService.get<Environment>('NODE_ENV') === 'production' &&
                services.includes(GoodServiceEnum.YANDEX),
        );
    }
}
