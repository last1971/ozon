import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebirdPool } from 'ts-firebird';
import { chunk } from 'lodash';
import { FIREBIRD } from '../firebird/firebird.module';
import { WithTransactions } from '../helpers/mixin/transaction.mixin';

/**
 * Строки прихода Trade. Единственное место в ozon, знающее, в какой таблице они лежат:
 * магазин — SHOPIN (NP целое), опт — SKLADIN (NP строка); выбор по STORAGE_TYPE, как раньше в опросе.
 */
@Injectable()
export class IncomingStore extends WithTransactions(class {}) {
    private readonly logger = new Logger(IncomingStore.name);
    private readonly table: 'SHOPIN' | 'SKLADIN';

    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        configService: ConfigService,
    ) {
        super();
        this.table =
            configService.get<string>('STORAGE_TYPE', 'SHOPSKLAD').toUpperCase() === 'SHOPSKLAD' ? 'SHOPIN' : 'SKLADIN';
    }

    /** Коды товаров по приходам: номер прихода → коды без повторов, в порядке первого появления. */
    async goodsByPrihod(nps: string[]): Promise<Map<string, string[]>> {
        const byNp = new Map<string, string[]>();
        for (const part of chunk(nps, 500)) {
            // Коммитит withTransaction; query(..., true) коммитил бы второй раз — «Invalid transaction handle» (19.10.2026).
            const rows = await this.withTransaction((transaction) =>
                transaction.query(
                    `SELECT DISTINCT NP, GOODSCODE FROM ${this.table} WHERE NP IN (${part.map(() => '?').join(', ')})`,
                    part.map((np) => (this.table === 'SHOPIN' ? Number(np) : np)),
                ),
            );
            for (const r of rows) {
                const np = String(r.NP).trim();
                const code = String(r.GOODSCODE);
                const codes = byNp.get(np) ?? [];
                if (!codes.includes(code)) codes.push(code);
                byNp.set(np, codes);
            }
        }
        return byNp;
    }
}
