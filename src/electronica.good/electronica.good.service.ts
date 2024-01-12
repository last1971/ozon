import { Injectable } from '@nestjs/common';
import { IGood } from '../interfaces/IGood';
import { GoodDto } from '../good/dto/good.dto';
import { ElectronicaApiService } from '../electronica.api/electronica.api.service';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import { ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { GoodWbDto } from '../good/dto/good.wb.dto';
@Injectable()
export class ElectronicaGoodService implements IGood {
    constructor(private api: ElectronicaApiService) {}

    updateWbCategory(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    async in(codes: string[]): Promise<GoodDto[]> {
        const response = await this.api.method('/api/good', {
            page: 1,
            itemsPerPage: -1,
            with: ['retailStore'],
            filterAttributes: ['GOODSCODE'],
            filterOperators: ['IN'],
            filterValues: ['[' + codes.join() + ']'],
        });
        return response.data.map(
            (good: any): GoodDto => ({
                code: good.GOODSCODE,
                quantity: good.retailStore?.QUAN || 0,
                reserve: 0,
                name: '',
            }),
        );
    }
    async prices(codes: string[]): Promise<GoodPriceDto[]> {
        return [];
    }
    async getPerc(codes: string[]): Promise<GoodPercentDto[]> {
        return [];
    }
    async setPercents(perc: GoodPercentDto): Promise<void> {}

    async getQuantities(goodCodes: string[]): Promise<Map<string, number>> {
        return new Map<string, number>();
    }

    async updateCountForSkus(service: ICountUpdateable, skus: string[]): Promise<number> {
        return 0;
    }
    async updateCountForService(service: ICountUpdateable, args: any): Promise<number> {
        return 0;
    }

    updatePriceForService(service: IPriceUpdateable, skus: string[]): Promise<any> {
        return Promise.resolve(undefined);
    }

    getWbData(ids: string[]): Promise<GoodWbDto[]> {
        return Promise.resolve([]);
    }

    setWbData(data: GoodWbDto): Promise<void> {
        return Promise.resolve(undefined);
    }
}
