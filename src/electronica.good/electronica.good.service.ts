import { Injectable } from '@nestjs/common';
import { IGood } from '../interfaces/IGood';
import { GoodDto } from '../good/good.dto';
import { ElectronicaApiService } from '../electronica.api/electronica.api.service';

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
}
