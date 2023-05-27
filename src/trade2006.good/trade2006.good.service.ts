import { Inject, Injectable } from '@nestjs/common';
import { IGood } from '../interfaces/IGood';
import { GoodDto } from '../good/good.dto';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdDatabase } from 'ts-firebird';

@Injectable()
export class Trade2006GoodService implements IGood {
    constructor(@Inject(FIREBIRD) private db: FirebirdDatabase) {}

    async in(codes: string[]): Promise<GoodDto[]> {
        if (codes.length === 0) return [];
        const response: any[] = await this.db.query(
            `SELECT GOODS.GOODSCODE, SHOPSKLAD.QUAN  FROM GOODS JOIN SHOPSKLAD ON GOODS.GOODSCODE = SHOPSKLAD.GOODSCODE WHERE GOODS.GOODSCODE IN (${'?'
                .repeat(codes.length)
                .split('')
                .join()})`,
            codes,
        );
        return response.map((item): GoodDto => ({ code: item.GOODSCODE, quantity: item.QUAN }));
    }
}
