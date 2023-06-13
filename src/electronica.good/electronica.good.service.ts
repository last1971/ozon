import { Injectable } from '@nestjs/common';
import { IGood } from '../interfaces/IGood';
import { GoodDto } from '../good/dto/good.dto';
import { ElectronicaApiService } from '../electronica.api/electronica.api.service';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';

@Injectable()
export class ElectronicaGoodService implements IGood {
    constructor(private api: ElectronicaApiService) {}
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
            (good: any): GoodDto => ({ code: good.GOODSCODE, quantity: good.retailStore?.QUAN || 0 }),
        );
    }
    async prices(codes: string[]): Promise<GoodPriceDto[]> {
        return [];
    }
    async getPerc(codes: string[]): Promise<GoodPercentDto[]> {
        return [];
    }
    async setPercents(perc: GoodPercentDto): Promise<void> {}
}
