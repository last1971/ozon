import { Inject, Injectable } from '@nestjs/common';
import { IGood } from '../interfaces/IGood';
import { GoodDto } from '../good/dto/good.dto';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdDatabase } from 'ts-firebird';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';

@Injectable()
export class Trade2006GoodService implements IGood {
    constructor(@Inject(FIREBIRD) private db: FirebirdDatabase) {}

    async in(codes: string[]): Promise<GoodDto[]> {
        if (codes.length === 0) return [];
        const response: any[] = await this.db.query(
            `SELECT GOODS.GOODSCODE, SHOPSKLAD.QUAN, (SELECT SUM(QUANSHOP) + SUM(QUANSKLAD) from RESERVEDPOS where GOODS.GOODSCODE = RESERVEDPOS.GOODSCODE) AS RES  FROM GOODS JOIN SHOPSKLAD ON GOODS.GOODSCODE = SHOPSKLAD.GOODSCODE WHERE GOODS.GOODSCODE IN (${'?'
                .repeat(codes.length)
                .split('')
                .join()})`,
            codes,
        );
        return response.map((item): GoodDto => ({ code: item.GOODSCODE, quantity: item.QUAN, reserve: item.RES }));
    }

    async prices(codes: string[]): Promise<GoodPriceDto[]> {
        if (codes.length === 0) return [];
        const response: any[] = await this.db.query(
            'select g.goodscode, n.name, ' +
                '( select sum(t.ost * t.price)/sum(t.ost) from (select price, quan -  COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) as ost' +
                '  from pr_meta where pr_meta.goodscode=g.goodscode and pr_meta.shopincode is not null' +
                '  and COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) < quan) t' +
                ') as pric from goods g, name n ' +
                `where g.namecode=n.namecode and g.goodscode in (${'?'.repeat(codes.length).split('').join()})`,
            codes,
        );
        return response.map(
            (good: any): GoodPriceDto => ({
                code: good.GOODSCODE,
                name: good.NAME,
                price: good.PRIC,
            }),
        );
    }
    async getPerc(codes: string[]): Promise<GoodPercentDto[]> {
        if (codes.length === 0) return [];
        const pecents = await this.db.query(
            `select * from ozon_perc where goodscode in (${'?'.repeat(codes.length).split('').join()})`,
            codes,
        );
        return pecents.map((percent) => ({
            offer_id: percent.GOODSCODE,
            pieces: percent.PIECES,
            perc: percent.PERC_NOR,
            adv_perc: percent.PERC_ADV,
            old_perc: percent.PERC_MAX,
            min_perc: percent.PERC_MIN,
        }));
    }
    async setPercents(perc: GoodPercentDto): Promise<void> {
        await this.db.execute(
            'UPDATE OR INSERT INTO OZON_PERC (PERC_MIN, PERC_NOR, PERC_MAX, PERC_ADV, GOODSCODE, PIECES)' +
                'VALUES (?, ?, ?, ?, ?, ?) MATCHING (GOODSCODE, PIECES)',
            [
                perc.min_perc || null,
                perc.perc || null,
                perc.old_perc || null,
                perc.adv_perc || null,
                goodCode(perc),
                goodQuantityCoeff(perc),
            ],
        );
    }
}
