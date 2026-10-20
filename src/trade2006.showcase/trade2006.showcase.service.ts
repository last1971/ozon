import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { ShowcaseArrival, ShowcaseSales, ShowcaseSupplierArrival } from '../helpers/showcase/showcase.lists';

/**
 * Данные Trade для витрин сайта — только чтение (база магазина). Дата окна приходит параметром из кода,
 * поэтому запросам всё равно, в каком диалекте соединение.
 */
@Injectable()
export class Trade2006ShowcaseService {
    constructor(@Inject(FIREBIRD) private readonly pool: FirebirdPool) {}

    /** Коды с остатком в магазине (SHOPSKLAD; строк на товар может быть несколько — по сумме). */
    async inShopStock(): Promise<Set<string>> {
        const t = await this.pool.getTransaction();
        const rows = await t.query('SELECT GOODSCODE FROM SHOPSKLAD GROUP BY GOODSCODE HAVING SUM(QUAN) > 0', [], true);
        return new Set(rows.map((r: { GOODSCODE: number | string }) => String(r.GOODSCODE)));
    }

    /** Первый приход в магазин (SHOPIN) у товаров, чей первый приход не раньше since. */
    async firstShopArrivals(since: Date): Promise<ShowcaseArrival[]> {
        const t = await this.pool.getTransaction();
        const rows = await t.query(
            'SELECT GOODSCODE, MIN(DATA) AS FIRST_IN FROM SHOPIN GROUP BY GOODSCODE HAVING MIN(DATA) >= ?',
            [since],
            true,
        );
        return rows.map((r: { GOODSCODE: number | string; FIRST_IN: Date | string }) => ({
            code: String(r.GOODSCODE),
            firstIn: new Date(r.FIRST_IN),
        }));
    }

    /**
     * Последний приход в магазин от поставщика (TRUEPRIH, FOR_SHOP = 1) не раньше since. Поставщики из exclude —
     * возвраты и пересортица, не поставка. Число параметров IN — по длине списка, сами коды — параметрами.
     */
    async lastSupplierArrivals(since: Date, exclude: number[]): Promise<ShowcaseSupplierArrival[]> {
        const t = await this.pool.getTransaction();
        const notIn = exclude.length ? ` AND WHEREISPOSTCODE NOT IN (${exclude.map(() => '?').join(', ')})` : '';
        const rows = await t.query(
            `SELECT GOODSCODE, MAX(DATA) AS LAST_IN FROM TRUEPRIH WHERE FOR_SHOP = 1 AND DATA >= ?${notIn} ` +
                'GROUP BY GOODSCODE',
            [since, ...exclude],
            true,
        );
        return rows.map((r: { GOODSCODE: number | string; LAST_IN: Date | string }) => ({
            code: String(r.GOODSCODE),
            lastIn: new Date(r.LAST_IN),
        }));
    }

    /**
     * Продажи с since: розница — строки кассы SHOPLOG (QUANSHOP > 0), счета — счёт-фактуры SF (один SF = один заказ
     * маркетплейса). Документы и штуки по коду, по строке на источник — складывает buildHitsList.
     */
    async sales(since: Date): Promise<ShowcaseSales[]> {
        const t = await this.pool.getTransaction();
        try {
            const retail = await t.query(
                'SELECT GOODSCODE, COUNT(*) AS SALES, SUM(QUANSHOP) AS PIECES FROM SHOPLOG ' +
                    'WHERE DATA >= ? AND QUANSHOP > 0 GROUP BY GOODSCODE',
                [since],
                false,
            );
            const invoices = await t.query(
                'SELECT rf.GOODSCODE, COUNT(DISTINCT f.SFCODE) AS SALES, SUM(rf.QUAN) AS PIECES FROM SF f ' +
                    'JOIN REALPRICEF rf ON rf.SFCODE = f.SFCODE WHERE f.DATA >= ? GROUP BY rf.GOODSCODE',
                [since],
                false,
            );
            await t.commit(true);
            return [...retail, ...invoices].map(
                (r: { GOODSCODE: number | string; SALES: number | string; PIECES: number | string }) => ({
                    code: String(r.GOODSCODE),
                    sales: Number(r.SALES) || 0,
                    pieces: Number(r.PIECES) || 0,
                }),
            );
        } catch (e) {
            await t.rollback(true).catch(() => undefined);
            throw e;
        }
    }
}
