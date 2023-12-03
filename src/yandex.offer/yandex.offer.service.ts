import { Injectable, OnModuleInit } from '@nestjs/common';
import { AbstractOfferService } from './abstract.offer.service';
import { Environment } from '../env.validation';

@Injectable()
export class YandexOfferService extends AbstractOfferService implements OnModuleInit {
    async onModuleInit(): Promise<any> {
        const yandex = await this.vaultService.get('yandex-seller');
        this.campaignId = parseInt(yandex['electronica-company'] as string);
        this.warehouseId = parseInt(yandex['electronica-fbs-tomsk'] as string);
        await this.loadSkuList(this.configService.get<Environment>('NODE_ENV') === 'production');
    }
}
