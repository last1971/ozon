import { Inject, Injectable } from '@nestjs/common';
import { IGood } from '../interfaces/IGood';
import { GoodDto } from '../good/dto/good.dto';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdDatabase } from 'ts-firebird';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class Trade2006GoodService implements IGood {
    constructor(@Inject(FIREBIRD) private db: FirebirdDatabase, private configService: ConfigService) {}

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

    async prices(codes: string[]): Promise<GoodPriceDto[]> {
        if (codes.length === 0) return [];
        const response: any[] = await this.db.query(
            'select g.goodscode, n.name, ' +
                'coalesce(o.perc_min, ?) as PERC_MIN, coalesce(o.perc_nor, ?) as PERC_NOR, coalesce(o.perc_max, ?)' +
                ' as PERC_MAX, coalesce(o.perc_adv, 0) AS PERC_ADV, ' +
                '( select sum(t.ost * t.price)/sum(t.ost) from (select price, quan -  COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) as ost' +
                '  from pr_meta where pr_meta.goodscode=g.goodscode and pr_meta.shopincode is not null' +
                '  and COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) < quan) t' +
                ') as pric ' +
                'from goods g, name n left join ozon_perc o on o.goodscode=g.goodscode ' +
                `where g.namecode=n.namecode and g.goodscode in (${'?'.repeat(codes.length).split('').join()})`,
            [
                this.configService.get<number>('PERC_MIN', 15),
                this.configService.get<number>('PERC_NOR', 30),
                this.configService.get<number>('PERC_MAX', 100),
                ...codes,
            ],
        );
        return response.map(
            (good: any): GoodPriceDto => ({
                code: good.GOODSCODE,
                name: good.NAME,
                perc_min: good.PERC_MIN,
                perc_nor: good.PERC_NOR,
                perc_max: good.PERC_MAX,
                perc_adv: good.PREC_ADV,
                price: good.PRICE,
            }),
        );
    }
}
