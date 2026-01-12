import { Inject, Injectable, Logger } from '@nestjs/common';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { ObtainCoeffsDto } from '../helpers/dto/obtain.coeffs.dto';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { SyliusApiService } from '../sylius/sylius.api.service';
import { SyliusProductService } from '../sylius/sylius.product.service';
import { SyliusPriceCoeffsAdapter } from './sylius.price.coeffs.adapter';
import Excel from 'exceljs';

@Injectable()
export class SyliusPriceService implements IPriceUpdateable {
    private readonly logger = new Logger(SyliusPriceService.name);

    constructor(
        private configService: ConfigService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private api: SyliusApiService,
        private syliusProductService: SyliusProductService,
    ) {}

    getObtainCoeffs(): ObtainCoeffsDto {
        return {
            minMil: this.configService.get<number>('SYLIUS_MIN_MIL', 0),
            percMil: this.configService.get<number>('SYLIUS_PERC_MIL', 0),
            percEkv: this.configService.get<number>('SYLIUS_PERC_EKV', 0),
            sumObtain: this.configService.get<number>('SYLIUS_SUM_OBTAIN', 0),
            sumLabel: this.configService.get<number>('SUM_LABEL', 2),
            taxUnit: this.configService.get<number>('TAX_UNIT', 6),
        };
    }

    async getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]> {
        const extPerc = this.configService.get<number>('SYLIUS_EXT_PERC', 0);
        return skus.map((sku) => new SyliusPriceCoeffsAdapter(sku, extPerc));
    }

    async updatePrices(updatePrices: UpdatePriceDto[]): Promise<any> {
        this.logger.log(`Updating ${updatePrices.length} prices on Sylius`);

        if (updatePrices.length === 0) {
            return [];
        }

        const prices: Record<string, { price: number; originalPrice?: number; minimumPrice?: number }> = {};

        for (const updatePrice of updatePrices) {
            const code = updatePrice.offer_id.toString();

            if (!this.syliusProductService.skuList.includes(code)) {
                continue;
            }

            prices[code] = {
                price: Math.round(parseFloat(updatePrice.price || '0') * 100),
                originalPrice: Math.round(parseFloat(updatePrice.old_price || '0') * 100),
                minimumPrice: Math.round(parseFloat(updatePrice.min_price || '0') * 100),
            };
        }

        if (Object.keys(prices).length === 0) {
            this.logger.log('No valid SKUs to update on Sylius');
            return [];
        }

        try {
            const result = await this.api.method<{ updated: number; notFound: number }>(
                '/api/v2/admin/price/update',
                'post',
                { prices },
            );
            this.logger.log(`Sylius: updated ${result.updated}, not found ${result.notFound}`);
            return [];
        } catch (error) {
            this.logger.error('Error updating prices on Sylius:', error.message);
            return [{ offer_id: 'batch', error: error.message }];
        }
    }

    async updateAllPrices(level = 0, args: any = null): Promise<any> {
        const variants = await this.syliusProductService.getGoodIds(args);
        await this.goodService.updatePriceForService(this, Array.from(variants.goods.keys()));

        if (variants.nextArgs) {
            await this.updateAllPrices(level + 1, variants.nextArgs);
        }

        if (level === 0) {
            this.logger.log('All Sylius Prices was updated');
        }

        return [];
    }

    async createAction(_file: Express.Multer.File): Promise<Excel.Buffer> {
        const workbook = new Excel.Workbook();
        const worksheet = workbook.addWorksheet('Sylius Prices');
        worksheet.addRow(['SKU', 'Price', 'Status']);
        return workbook.xlsx.writeBuffer() as Promise<Excel.Buffer>;
    }
}
