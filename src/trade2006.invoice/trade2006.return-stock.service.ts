import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { isMarkCodesEnabled, storageSS } from '../helpers';
import { IReturnStock, ReturnInvoiceLine, ReturnLineCode, SpisanieDto } from '../interfaces/i.return.stock';
import { markRequiredExists } from '../helpers/mark-required.sql';

/** Переносы склад↔магазин в справочнике оснований — не списание, в список не показываем. */
const TRANSFER_REASON_IDS = [10, 24, 25];

/**
 * Складские операции приёма и списания возврата в Trade2006 — только вызовы штатных процедур
 * и чтение. Порядок и правила — в командах приёма/списания (src/mp-return/commands).
 */
@Injectable()
export class Trade2006ReturnStockService implements IReturnStock {
    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        private readonly configService: ConfigService,
    ) {}

    storageSS(): 0 | 1 {
        return storageSS(this.configService);
    }

    async getLines(scode: number, t: FirebirdTransaction): Promise<ReturnInvoiceLine[]> {
        const shop = this.storageSS() === 1;
        const rows = await t.query(
            'SELECT r.REALPRICECODE, r.GOODSCODE, r.QUAN, r.PIECES, n.NAME, pp.PODBPOSCODE, ' +
                (shop
                    ? 'pp.QUANSHOP AS PICKED, pp.QUANSHOPNEED AS NEED, '
                    : 'pp.QUANSKLAD AS PICKED, pp.QUANSKLADNEED AS NEED, ') +
                'COALESCE((SELECT SUM(f.QUAN) FROM REALPRICEF f WHERE f.REALPRICECODE = r.REALPRICECODE), 0) - ' +
                'COALESCE((SELECT SUM(d.QUAN) FROM SF_VOZVR v JOIN SFDETAIL_VOZVR d ON d.SF_VOZVR_ID = v.ID ' +
                'WHERE v.WIRED = 1 AND d.REALPRICECODE = r.REALPRICECODE), 0) AS SHIPPED ' +
                'FROM REALPRICE r ' +
                'LEFT JOIN PODBPOS pp ON pp.REALPRICECODE = r.REALPRICECODE AND pp.SKLAD_ID IS NULL ' +
                'LEFT JOIN GOODS g ON g.GOODSCODE = r.GOODSCODE ' +
                'LEFT JOIN NAME n ON n.NAMECODE = g.NAMECODE ' +
                'WHERE r.SCODE = ? ORDER BY r.REALPRICECODE',
            [scode],
            false,
        );
        return rows.map((r: any) => ({
            realpricecode: Number(r.REALPRICECODE),
            goodscode: String(r.GOODSCODE),
            name: r.NAME ?? null,
            quantity: Number(r.QUAN) || 0,
            pieces: Number(r.PIECES) > 0 ? Number(r.PIECES) : null,
            podbposcode: r.PODBPOSCODE ?? null,
            picked: Number(r.PICKED) || 0,
            need: Number(r.NEED) || 0,
            shipped: Math.max(0, Number(r.SHIPPED) || 0),
        }));
    }

    async getLineCodes(realpricecode: number, t: FirebirdTransaction): Promise<ReturnLineCode[]> {
        // Маркировка выключена (магазин) — таблицы MARKCODES нет.
        if (!isMarkCodesEnabled(this.configService)) return [];
        const rows = await t.query(
            'SELECT KI, COALESCE(QUANTITY, 1) AS QUANTITY, STATUS, TRANSFER_TYPE, RETIRE_REASON, CHZ_SENT_AT ' +
                'FROM MARKCODES WHERE REALPRICECODE = ? ORDER BY MARKCODE',
            [realpricecode],
            false,
        );
        return rows.map((r: any) => ({
            ki: String(r.KI),
            quantity: Number(r.QUANTITY) || 1,
            status: Number(r.STATUS),
            transferType: Number(r.TRANSFER_TYPE),
            retireReason: r.RETIRE_REASON == null ? null : Number(r.RETIRE_REASON),
            chzSent: r.CHZ_SENT_AT != null,
        }));
    }

    async hasPicked(scode: number, t: FirebirdTransaction): Promise<boolean> {
        const rows = await t.query(
            'SELECT FIRST 1 1 AS X FROM PODBPOS pp JOIN REALPRICE r ON r.REALPRICECODE = pp.REALPRICECODE ' +
                'WHERE r.SCODE = ? AND (pp.QUANSKLAD > 0 OR pp.QUANSHOP > 0 OR COALESCE(pp.QUAN, 0) > 0)',
            [scode],
            false,
        );
        return rows.length > 0;
    }

    async updatePodb(
        p: {
            goodscode: string;
            deltaQuan: number;
            deltaNeed: number;
            realpricecode: number;
            scode: number;
            username: string;
        },
        t: FirebirdTransaction,
    ): Promise<void> {
        // UPDATE_PODB(GOODSCODE, DELTAQUAN, DELTAQUANNEED, SKLADID, ROZN_DETAIL_ID, REALPRICECODE, SCODE,
        //             USERNAME, PODBPOSCODE, DIRECT_QUAN, NO_PODB) — штатная, её зовут SF_VOZVR_REGISTER и PODBPOS_MIGRATE_QTY.
        await t.execute(
            'EXECUTE PROCEDURE UPDATE_PODB (?, ?, ?, ?, NULL, ?, ?, ?, NULL, 0, 0)',
            [
                Number(p.goodscode),
                p.deltaQuan,
                p.deltaNeed,
                this.storageSS(),
                p.realpricecode,
                p.scode,
                p.username.slice(0, 80),
            ],
            false,
        );
    }

    async detachFromRealprice(ki: string, realpricecode: number, t: FirebirdTransaction): Promise<void> {
        await t.execute(
            'EXECUTE PROCEDURE MARKCODE_DETACH_FROM_REALPRICE (?, ?, ?)',
            [ki, realpricecode, this.storageSS()],
            false,
        );
    }

    async setLineQuantitiesToPicked(scode: number, t: FirebirdTransaction): Promise<void> {
        const picked =
            this.storageSS() === 1
                ? 'COALESCE((SELECT SUM(pp.QUANSHOP) FROM PODBPOS pp WHERE pp.REALPRICECODE = r.REALPRICECODE), 0)'
                : 'COALESCE((SELECT SUM(pp.QUANSKLAD) FROM PODBPOS pp WHERE pp.REALPRICECODE = r.REALPRICECODE), 0)';
        await t.execute(
            `UPDATE REALPRICE r SET r.QUAN = ${picked} WHERE r.SCODE = ? AND r.QUAN <> ${picked}`,
            [scode],
            false,
        );
    }

    async setInvoiceStatus(scode: number, status: number, t: FirebirdTransaction): Promise<void> {
        await t.execute('UPDATE S SET STATUS = ? WHERE SCODE = ?', [status, scode], false);
    }

    async isMarkRequired(goodscode: string, t: FirebirdTransaction): Promise<boolean> {
        if (!isMarkCodesEnabled(this.configService)) return false;
        const required = await t.query(
            `SELECT 1 AS X FROM RDB$DATABASE WHERE ${markRequiredExists('?')}`,
            [Number(goodscode)],
            false,
        );
        return required.length > 0;
    }

    async ensurePodbLine(
        p: { scode: number; goodscode: string; realpricecode: number },
        t: FirebirdTransaction,
    ): Promise<void> {
        const exists = await t.query(
            'SELECT FIRST 1 1 AS X FROM PODBPOS WHERE REALPRICECODE = ? AND SKLAD_ID IS NULL',
            [p.realpricecode],
            false,
        );
        if (exists.length) return;
        await t.execute(
            'INSERT INTO PODBPOS (SCODE, GOODSCODE, REALPRICECODE, DATASTART, QUANSKLAD, QUANSHOP, QUANSKLADNEED, QUANSHOPNEED) ' +
                "VALUES (?, ?, ?, CAST('NOW' AS DATE), 0, 0, 0, 0)",
            [p.scode, Number(p.goodscode), p.realpricecode],
            false,
        );
    }

    async hasFreeMarkCodes(goodscode: string, t: FirebirdTransaction): Promise<boolean> {
        if (!(await this.isMarkRequired(goodscode, t))) return false;
        const free = await t.query(
            'SELECT FREE_COUNT FROM COUNT_FREE_MARKCODES_FOR_GOOD (?)',
            [Number(goodscode)],
            false,
        );
        return Number(free?.[0]?.FREE_COUNT) > 0;
    }

    async stockAndReserve(
        goodscode: string,
        t: FirebirdTransaction,
    ): Promise<{ stock: number; reserved: number; reservedBy: number[] }> {
        const ss = this.storageSS();
        const gc = Number(goodscode);
        const stock = await t.query('SELECT QUAN FROM QUAN_IN_SKLADS(?) WHERE ID = ?', [gc, ss], false);
        const reserve = await t.query('SELECT QUAN FROM GET_RESERV(?, ?, 0, 0)', [gc, ss], false);
        const by = await t.query(
            'SELECT FIRST 5 DISTINCT s.NS FROM RESERVEDPOS rp ' +
                'JOIN REALPRICE r ON r.REALPRICECODE = rp.REALPRICECODE JOIN S s ON s.SCODE = r.SCODE ' +
                `WHERE rp.GOODSCODE = ? AND rp.${ss === 1 ? 'QUANSHOP' : 'QUANSKLAD'} > 0`,
            [gc],
            false,
        );
        return {
            stock: Number(stock?.[0]?.QUAN) || 0,
            reserved: Number(reserve?.[0]?.QUAN) || 0,
            reservedBy: by.map((r: any) => Number(r.NS)).filter((n: number) => n > 0),
        };
    }

    async allocateSpisCode(t: FirebirdTransaction): Promise<number> {
        const gen = this.storageSS() === 1 ? 'SPISSHOPCODE_GEN' : 'SPISSKLADCODE_GEN';
        const rows = await t.query(`SELECT GEN_ID(${gen}, 1) AS X FROM RDB$DATABASE`, [], false);
        return Number(rows[0].X);
    }

    async setSpisContext(spisCode: number, t: FirebirdTransaction): Promise<void> {
        const name = this.storageSS() === 1 ? 'SPIS_SHOPCODE' : 'SPIS_SKLADCODE';
        await t.query(
            `SELECT RDB$SET_CONTEXT('USER_TRANSACTION', '${name}', ?) AS X FROM RDB$DATABASE`,
            [spisCode],
            false,
        );
    }

    async stampForSpis(ki: string, goodscode: string, spisCode: number, t: FirebirdTransaction): Promise<void> {
        await t.execute(
            'EXECUTE PROCEDURE MARKCODE_STAMP_FOR_SPIS (?, ?, ?, ?)',
            [ki, Number(goodscode), this.storageSS(), spisCode],
            false,
        );
    }

    async spisanie(p: SpisanieDto, t: FirebirdTransaction): Promise<void> {
        // SPISANIE_UNIV1(GOODSCODE, USERNAME, QUAN, PRIM, SKLAD_ID, PRICE, DATA, STAFF_ID, QUAN0, QUAN1, OSN_SPIS_ID).
        // Как Delphi без права «цена в списании»: PRICE=NULL → процедура берёт розничную; DATA=NULL → сегодня;
        // QUAN0/QUAN1=0 — режим «два склада» маркированному запрещён; USERNAME — VARCHAR(30) в DELTAQUANSHOPSKLAD4.
        await t.execute(
            'EXECUTE PROCEDURE SPISANIE_UNIV1 (?, ?, ?, ?, ?, NULL, NULL, ?, 0, 0, ?)',
            [
                Number(p.goodscode),
                p.username.slice(0, 30),
                p.quan,
                p.prim.slice(0, 250),
                this.storageSS(),
                this.configService.get<number>('STAFF_ID') ?? null,
                p.osnSpisId,
            ],
            false,
        );
    }

    async spisDocExists(spisCode: number, t: FirebirdTransaction): Promise<boolean> {
        const sql =
            this.storageSS() === 1
                ? 'SELECT FIRST 1 1 AS X FROM SPISSHOP WHERE SPISSHOPCODE = ?'
                : 'SELECT FIRST 1 1 AS X FROM SPISSKLAD WHERE SPISSKLADCODE = ?';
        const rows = await t.query(sql, [spisCode], false);
        return rows.length > 0;
    }

    async listWriteOffReasons(): Promise<{ id: number; name: string }[]> {
        const t = await this.pool.getTransaction();
        try {
            const rows = await t.query(
                `SELECT ID, NAME FROM OSN_SPIS WHERE ID NOT IN (${TRANSFER_REASON_IDS.join(',')}) ORDER BY ID`,
                [],
                false,
            );
            await t.commit(true);
            return rows.map((r: any) => ({ id: Number(r.ID), name: String(r.NAME).trim() }));
        } catch (e) {
            await t.rollback(true).catch(() => undefined);
            throw e;
        }
    }
}
