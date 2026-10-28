import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';

/** Привязка этикетки Озона к экземпляру — строка OZON_SUPPLY_QR (патч 67). */
export interface SupplyQrRecord {
    qr: string;
    cargoId: string;
    offerId: string;
    ozonBarcode: string | null;
    goodscode: number;
    markcode: number | null;
    ki: string | null;
    scanRaw: string | null;
    username: string | null;
    createdAt: Date;
}

export type NewSupplyQr = Omit<SupplyQrRecord, 'ki' | 'createdAt'>;

/** Код ЧЗ так, как его видит проверка «можно ли отправить в поставку». */
export interface MarkState {
    markcode: number;
    goodscode: number;
    status: number;
    transferType: number;
    quantity: number;
    realpricecode: number | null;
    /** Товар строки счёта, к которой привязан код. */
    lineGoodscode: number | null;
    invoiceNumber: number | null;
    invoicePrim: string | null;
}

const SELECT =
    'SELECT q.QR, q.CARGO_ID, q.OFFER_ID, q.OZON_BARCODE, q.GOODSCODE, q.MARKCODE, m.KI, q.SCAN_RAW, q.USERNAME, q.CREATED_AT ' +
    'FROM OZON_SUPPLY_QR q LEFT JOIN MARKCODES m ON m.MARKCODE = q.MARKCODE ';

/**
 * Этикетки экземпляров поставки FBO и всё, что экрану нужно прочитать из базы узла.
 * Уникальность QR и кода ЧЗ держит сама таблица: повторная привязка падает на вставке.
 */
@Injectable()
export class SupplyQrStore {
    constructor(@Inject(FIREBIRD) private readonly pool: FirebirdPool) {}

    transaction(): Promise<FirebirdTransaction> {
        return this.pool.getTransaction();
    }

    async byCargo(cargoIds: string[], t: FirebirdTransaction): Promise<SupplyQrRecord[]> {
        const result: SupplyQrRecord[] = [];
        for (let i = 0; i < cargoIds.length; i += 100) {
            const part = cargoIds.slice(i, i + 100);
            const rows = await t.query(
                SELECT + `WHERE q.CARGO_ID IN (${part.map(() => '?').join(',')}) ORDER BY q.CREATED_AT, q.QR`,
                part,
                false,
            );
            result.push(...rows.map(toRecord));
        }
        return result;
    }

    async byQr(qr: string, t: FirebirdTransaction): Promise<SupplyQrRecord | null> {
        const rows = await t.query(SELECT + 'WHERE q.QR = ?', [qr], false);
        return rows.length ? toRecord(rows[0]) : null;
    }

    async byMarkcode(markcode: number, t: FirebirdTransaction): Promise<SupplyQrRecord | null> {
        const rows = await t.query(SELECT + 'WHERE q.MARKCODE = ?', [markcode], false);
        return rows.length ? toRecord(rows[0]) : null;
    }

    async countBound(cargoId: string, offerId: string, t: FirebirdTransaction): Promise<number> {
        const rows = await t.query(
            'SELECT COUNT(*) AS N FROM OZON_SUPPLY_QR WHERE CARGO_ID = ? AND OFFER_ID = ?',
            [cargoId, offerId],
            false,
        );
        return Number(rows[0]?.N ?? 0);
    }

    async insert(rec: NewSupplyQr, t: FirebirdTransaction): Promise<void> {
        await t.execute(
            'INSERT INTO OZON_SUPPLY_QR (QR, CARGO_ID, OFFER_ID, OZON_BARCODE, GOODSCODE, MARKCODE, SCAN_RAW, USERNAME)' +
                ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                rec.qr,
                rec.cargoId,
                rec.offerId,
                rec.ozonBarcode,
                rec.goodscode,
                rec.markcode,
                rec.scanRaw ? rec.scanRaw.slice(0, 200) : null,
                rec.username ? rec.username.slice(0, 80) : null,
            ],
            false,
        );
    }

    async delete(qr: string, t: FirebirdTransaction): Promise<boolean> {
        const before = await this.byQr(qr, t);
        if (!before) return false;
        await t.execute('DELETE FROM OZON_SUPPLY_QR WHERE QR = ?', [qr], false);
        return true;
    }

    /** Товары по штрихкоду: все строки классификатора, у товара GTIN может быть несколько. */
    async goodsByGtin(gtins: string[], t: FirebirdTransaction): Promise<number[]> {
        const rows = await t.query(
            `SELECT DISTINCT GOODSCODE FROM GOODS_CLASSIF WHERE GTIN IN (${gtins.map(() => '?').join(',')})`,
            gtins,
            false,
        );
        return rows.map((r: any) => Number(r.GOODSCODE));
    }

    async markByKi(ki: string, t: FirebirdTransaction): Promise<MarkState | null> {
        const rows = await t.query(
            'SELECT m.MARKCODE, m.GOODSCODE, m.STATUS, m.TRANSFER_TYPE, COALESCE(m.QUANTITY, 1) AS QUANTITY, m.REALPRICECODE,' +
                ' rp.GOODSCODE AS LINE_GC, s.NS, s.PRIM ' +
                'FROM MARKCODES m LEFT JOIN REALPRICE rp ON rp.REALPRICECODE = m.REALPRICECODE ' +
                'LEFT JOIN S s ON s.SCODE = rp.SCODE WHERE m.KI = ?',
            [ki],
            false,
        );
        if (!rows.length) return null;
        const r: any = rows[0];
        return {
            markcode: Number(r.MARKCODE),
            goodscode: Number(r.GOODSCODE),
            status: Number(r.STATUS),
            transferType: Number(r.TRANSFER_TYPE ?? 0),
            quantity: Number(r.QUANTITY),
            realpricecode: r.REALPRICECODE ?? null,
            lineGoodscode: r.LINE_GC == null ? null : Number(r.LINE_GC),
            invoiceNumber: r.NS == null ? null : Number(r.NS),
            invoicePrim: r.PRIM ?? null,
        };
    }

    async names(goodscodes: number[], t: FirebirdTransaction): Promise<Map<number, string>> {
        const names = new Map<number, string>();
        for (let i = 0; i < goodscodes.length; i += 100) {
            const part = goodscodes.slice(i, i + 100);
            const rows = await t.query(
                'SELECT g.GOODSCODE, n.NAME FROM GOODS g LEFT JOIN NAME n ON n.NAMECODE = g.NAMECODE ' +
                    `WHERE g.GOODSCODE IN (${part.map(() => '?').join(',')})`,
                part,
                false,
            );
            for (const r of rows) names.set(Number(r.GOODSCODE), r.NAME ? String(r.NAME).trim() : '');
        }
        return names;
    }
}

function toRecord(r: any): SupplyQrRecord {
    return {
        qr: String(r.QR).trim(),
        cargoId: String(r.CARGO_ID).trim(),
        offerId: String(r.OFFER_ID).trim(),
        ozonBarcode: r.OZON_BARCODE ?? null,
        goodscode: Number(r.GOODSCODE),
        markcode: r.MARKCODE == null ? null : Number(r.MARKCODE),
        ki: r.KI ?? null,
        scanRaw: r.SCAN_RAW ?? null,
        username: r.USERNAME ?? null,
        createdAt: new Date(r.CREATED_AT),
    };
}
