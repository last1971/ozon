import { Injectable, OnModuleInit } from '@nestjs/common';
import { AbstractOfferService } from './abstract.offer.service';

@Injectable()
export class ExpressOfferService extends AbstractOfferService implements OnModuleInit {
    async onModuleInit(): Promise<any> {
        const yandex = await this.vaultService.get('yandex-seller');
        this.campaignId = parseInt(yandex['electronica-express'] as string);
        this.warehouseId = parseInt(yandex['electronica-express-tomsk'] as string);
    }
}
