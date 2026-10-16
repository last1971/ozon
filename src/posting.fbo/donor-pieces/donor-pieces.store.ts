import { Inject, Injectable, Logger } from '@nestjs/common';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { FIREBIRD } from '../../firebird/firebird.module';
import { WithTransactions } from '../../helpers/mixin/transaction.mixin';
import { parseSupplyNumber } from './donor-pieces.matcher';
import { DonorPiecesInvoice } from './donor-pieces.types';

/**
 * Строки счетов-доноров FORFBO и запись их фасовки (REALPRICE.PIECES).
 *
 * Счета поставок заводят руками в Delphi, поля фасовки там нет — поэтому у доноров она пустая
 * всегда, а не только у старых. Заполняем по составу поставки Озона.
 */
@Injectable()
export class DonorPiecesStore extends WithTransactions(class {}) {
    private readonly logger = new Logger(DonorPiecesStore.name);

    constructor(@Inject(FIREBIRD) private readonly pool: FirebirdPool) {
        super();
    }

    /**
     * Живые (STATUS=1) счета FORFBO своего покупателя Озона, где есть строка без фасовки,
     * со ВСЕМИ строками: сверка штук идёт по товару целиком.
     */
    async loadDonors(buyerId: number, t?: FirebirdTransaction): Promise<DonorPiecesInvoice[]> {
        return this.withTransaction(async (transaction) => {
            const rows = await transaction.query(
                'SELECT s.SCODE, s.NS, s.PRIM, rp.REALPRICECODE, rp.GOODSCODE, rp.QUAN, rp.PIECES ' +
                    'FROM S s JOIN REALPRICE rp ON rp.SCODE = s.SCODE ' +
                    "WHERE s.PRIM CONTAINING 'FORFBO' AND s.STATUS = 1 AND s.POKUPATCODE = ? " +
                    'AND EXISTS (SELECT 1 FROM REALPRICE e WHERE e.SCODE = s.SCODE AND e.PIECES IS NULL) ' +
                    'ORDER BY s.SCODE, rp.REALPRICECODE',
                [buyerId],
                false,
            );
            const byScode = new Map<number, DonorPiecesInvoice>();
            for (const r of rows) {
                const scode = Number(r.SCODE);
                let invoice = byScode.get(scode);
                if (!invoice) {
                    const prim = String(r.PRIM ?? '').trim();
                    invoice = { scode, invoiceNumber: Number(r.NS), prim, supplyNumber: parseSupplyNumber(prim), lines: [] };
                    byScode.set(scode, invoice);
                }
                invoice.lines.push({
                    realpricecode: Number(r.REALPRICECODE),
                    goodscode: String(r.GOODSCODE),
                    quantity: Number(r.QUAN) || 0,
                    pieces: r.PIECES == null ? null : Number(r.PIECES),
                });
            }
            return [...byScode.values()];
        }, t);
    }

    /**
     * Фасовка строки — только в пустое поле: повторный проход (кнопка, потом крон) ничего не меняет.
     * Триггеры REALPRICE на это поле не завязаны (цена/количество/резерв не трогаются); AU0 лишь
     * пересверяет подборку и бросит, если подобрано больше, чем в строке, — это ловит вызывающий.
     */
    async setPieces(realpricecode: number, pieces: number, t: FirebirdTransaction): Promise<void> {
        await t.execute('UPDATE REALPRICE SET PIECES = ? WHERE REALPRICECODE = ? AND PIECES IS NULL', [pieces, realpricecode], false);
    }
}
