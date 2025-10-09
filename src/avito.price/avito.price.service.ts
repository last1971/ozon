import { Inject, Injectable, Logger } from '@nestjs/common';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { ObtainCoeffsDto } from '../helpers/dto/obtain.coeffs.dto';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { AvitoApiService } from '../avito.api/avito.api.service';
import { AvitoCardService } from '../avito.card/avito.card.service';
import { AvitoPriceCoeffsAdapter } from './avito.price.coeffs.adapter';
import Excel from 'exceljs';

@Injectable()
export class AvitoPriceService implements IPriceUpdateable {
    private logger = new Logger(AvitoPriceService.name);

    constructor(
        private configService: ConfigService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private api: AvitoApiService,
        private avitoCardService: AvitoCardService,
    ) {}

    getObtainCoeffs(): ObtainCoeffsDto {
        return {
            minMil: this.configService.get<number>('AVITO_MIN_MIL', 0),
            percMil: this.configService.get<number>('AVITO_PERC_MIL', 0),
            percEkv: this.configService.get<number>('AVITO_PERC_EKV', 0),
            sumObtain: this.configService.get<number>('AVITO_SUM_OBTAIN', 100),
            sumLabel: this.configService.get<number>('SUM_LABEL', 2),
            taxUnit: this.configService.get<number>('TAX_UNIT', 6),
        };
    }

    async getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]> {
        const ids = skus.map((sku) => this.avitoCardService.getAvitoId(sku));
        const avitoData = await this.goodService.getAvitoData(ids);

        if (!avitoData || avitoData.length === 0) {
            return [];
        }

        return avitoData.map(
            (avitoItem) => new AvitoPriceCoeffsAdapter(
                avitoItem,
                this.configService.get<number>('AVITO_EXT_PERC', 0)
            )
        );
    }

    async updatePrices(updatePrices: UpdatePriceDto[]): Promise<any> {
        this.logger.log(`Updating ${updatePrices.length} prices on Avito`);

        if (updatePrices.length === 0) {
            return { updated: 0, errors: [] };
        }

        const results = [];
        const errors = [];

        for (const updatePrice of updatePrices) {
            try {
                const avitoId = this.avitoCardService.getAvitoId(updatePrice.offer_id.toString());

                if (!avitoId) {
                    errors.push(`SKU ${updatePrice.offer_id} not found in Avito mapping`);
                    continue;
                }

                const response = await this.api.request<{ result: { success: boolean } }>(
                    `/core/v1/items/${avitoId}/update_price`,
                    { price: parseInt(updatePrice.min_price) },
                    'post'
                );

                if (response.result.success) {
                    results.push({
                        offer_id: updatePrice.offer_id,
                        avito_id: avitoId,
                        price: updatePrice.price,
                        success: true
                    });
                } else {
                    errors.push(`Failed to update price for SKU ${updatePrice.offer_id}`);
                }

            } catch (error) {
                this.logger.error(`Error updating price for SKU ${updatePrice.offer_id}:`, error);
                errors.push(`Error updating SKU ${updatePrice.offer_id}: ${error.message}`);
            }
        }

        this.logger.log(`Updated ${results.length} prices on Avito, ${errors.length} errors`);

        return {
            updated: results.length,
            errors,
            results
        };
    }

    async updateAllPrices(level = 0, args = ''): Promise<any> {
        const cards = await this.avitoCardService.getGoodIds(args);
        await this.goodService.updatePriceForService(this, Array.from(cards.goods.keys()));

        if (cards.nextArgs) {
            await this.updateAllPrices(level + 1, cards.nextArgs);
        }

        if (level === 0) {
            this.logger.log('All Avito Prices was updated');
        }

        return { updated: cards.goods.size, level };
    }

    async createAction(file: Express.Multer.File): Promise<Excel.Buffer> {
        // TODO: implement creating Excel action file for Avito
        const workbook = new Excel.Workbook();
        const worksheet = workbook.addWorksheet('Avito Prices');

        worksheet.addRow(['SKU', 'Price', 'Status']);

        return workbook.xlsx.writeBuffer() as Promise<Excel.Buffer>;
    }
}
