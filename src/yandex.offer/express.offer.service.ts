import { Injectable, OnModuleInit } from '@nestjs/common';
import { AbstractOfferService } from './abstract.offer.service';
import { Environment } from '../env.validation';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ProductInfoDto } from 'src/product/dto/product.info.dto';

@Injectable()
export class ExpressOfferService extends AbstractOfferService implements OnModuleInit {
    infoList(offer_id: string[]): Promise<ProductInfoDto[]> {
        throw new Error('Method not implemented.');
    }
    async onModuleInit(): Promise<any> {
        const yandex = await this.vaultService.get('yandex-seller');
        this.campaignId = parseInt(yandex['electronica-express'] as string);
        this.warehouseId = parseInt(yandex['electronica-express-tomsk'] as string);
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        await this.loadSkuList(
            this.configService.get<Environment>('NODE_ENV') === 'production' &&
                services.includes(GoodServiceEnum.EXPRESS),
        );
    }
}
