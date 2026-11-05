import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { OzonReturnValue, ozonReturnKey } from '../helpers/price/ozon.return.snapshot';

/** Единственное место записи статистики. Наценки, рынок и упаковка не изменяются. */
@Injectable()
export class OzonReturnStore {
    constructor(@Inject(FIREBIRD) private readonly pool: FirebirdPool) {}

    async save(values: readonly OzonReturnValue[], calculatedAt: Date, defaultPerc = 0): Promise<void> {
        const validPerc = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
        if (!validPerc(defaultPerc) || !Number.isFinite(calculatedAt.getTime()))
            throw new Error('Некорректный снимок возвратов');
        const keys = new Set<string>();
        for (const row of values) {
            const key = ozonReturnKey(`${row.goodscode}-${row.pieces}`);
            const id = `${key.goodscode}-${key.pieces}`;
            if (!validPerc(row.returnPerc) || keys.has(id))
                throw new Error('Некорректная или повторная строка возвратов');
            keys.add(id);
        }
        if (!values.length) return;
        const t = await this.pool.getTransaction();
        try {
            const newer = await t.query(
                'SELECT FIRST 1 GOODSCODE FROM OZON_PERC WHERE RETURN_PERC_AT > ?',
                [calculatedAt],
                false,
            );
            if (newer.length) throw new Error('Уже сохранён более новый расчёт возвратов');
            // У старых артикулов без истории в новом окне также снимаем устаревший процент.
            await t.execute(
                'UPDATE OZON_PERC SET RETURN_PERC = ?, RETURN_PERC_AT = ?',
                [defaultPerc, calculatedAt],
                false,
            );
            for (const row of values) {
                await t.execute(
                    'UPDATE OR INSERT INTO OZON_PERC (GOODSCODE, PIECES, RETURN_PERC, RETURN_PERC_AT) VALUES (?, ?, ?, ?) MATCHING (GOODSCODE, PIECES)',
                    [row.goodscode, row.pieces, Number(row.returnPerc.toFixed(6)), calculatedAt],
                    false,
                );
            }
            await t.commit(true);
        } catch (error) {
            await t.rollback(true).catch(() => undefined);
            throw error;
        }
    }
}
