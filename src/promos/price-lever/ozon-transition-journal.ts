import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FirebirdPool, FirebirdTransaction, ISOLATION_READ_COMMITTED } from 'ts-firebird';
import { FIREBIRD } from '../../firebird/firebird.module';
import { chunk } from 'lodash';
import type { PromoPriceApplyResult, PromoPriceState } from './promo-price.types';

export interface TransitionClaim<T> {
    token: string;
    createdAt: string;
    payload: T;
}

export interface OzonBaseReceipt {
    productId: number;
    price: number;
    minPrice: number;
    oldPrice: number;
}

/** A past import is usable only with the same listing and current import fields. */
export function attachOzonBaseReceipts(states: PromoPriceState[], receipts: Map<string, OzonBaseReceipt>, now = new Date()) {
    for (const state of states) {
        delete state.confirmedBase;
        const receipt = receipts.get(state.offerId);
        if (!receipt || receipt.productId !== state.productId || receipt.minPrice !== state.minPrice ||
            receipt.oldPrice !== state.oldPrice || !Number.isFinite(receipt.price) || receipt.price <= 0) continue;
        const masked = state.ozonActions.some(a => a.participant && a.actionPrice === state.price &&
            (!a.startsAt || Date.parse(a.startsAt) <= now.getTime()));
        if (state.price === receipt.price || (masked && state.price < receipt.price)) state.confirmedBase = receipt.price;
    }
    return states;
}

export interface TransitionNotice {
    result: PromoPriceApplyResult;
    deliveringUntil?: number;
}

type Stream = 'PRICE_STEP' | 'PROMO_NOTICE';
const OFFER_BATCH_SIZE = 100;
const PAYLOAD_PART_SIZE = 4096;

// Older cabinets keep the text BLOB in WIN1251. JSON escapes preserve every UTF-16
// code unit, including surrogate pairs; keep common Cyrillic compact for long receipts.
function journalJson(value: unknown): string {
    return JSON.stringify(value).replace(/[^\x20-\x7eА-Яа-яЁё]/g, ch =>
        '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

// Firebird возвращает текст напрямую, без сегментного чтения BLOB драйвером.
const payloadPart = (start: '1' | 'CAST(? AS INTEGER)') =>
    `CAST(SUBSTRING(PAYLOAD FROM ${start} FOR ${PAYLOAD_PART_SIZE}) AS VARCHAR(${PAYLOAD_PART_SIZE})) AS PART`;

const scope = "SERVICE = 'OZON' AND KIND = ? AND STATE = 'pending'";

/** Одна незавершённая запись на артикул в базе конкретного магазина.
 * Квитанция фиксируется до сетевой записи. Наблюдение старой цены не даёт права отправить шаг повторно. */
@Injectable()
export class OzonTransitionJournal {
    constructor(@Inject(FIREBIRD) private readonly pool: FirebirdPool) {}

    async pending<T>(offerId: string, stream: Stream = 'PRICE_STEP'): Promise<TransitionClaim<T> | null> {
        const entries = await this.read<T>(stream, offerId);
        return entries.get(offerId) ?? null;
    }

    outstanding<T>(stream: Stream = 'PRICE_STEP'): Promise<Map<string, TransitionClaim<T>>> {
        return this.read<T>(stream);
    }

    /** Версии до чтения Ozon. Даже если сосед успеет полностью открыть и закрыть шаг во время чтения,
     * CAS на первом шаге не позволит писать по уже устаревшему снимку. */
    async versions(offers: string[]): Promise<Map<string, string>> {
        const unique = [...new Set(offers)];
        if (!unique.length) return new Map();
        return this.transaction(async tx => {
            const versions = new Map<string, string>();
            for (const batch of chunk(unique, OFFER_BATCH_SIZE)) {
                const rows = await tx.query(
                    `SELECT EXT_ID, POSTING FROM MP_EVENT WHERE ${scope} AND EXT_ID IN (${batch.map(() => '?').join(', ')})`,
                    ['PRICE_STEP', ...batch], false,
                );
                for (const row of rows) versions.set(String(row.EXT_ID), String(row.POSTING));
            }
            return versions;
        });
    }

    async baseReceipts(offers: string[]): Promise<Map<string, OzonBaseReceipt>> {
        const ids = [...new Set(offers)];
        if (!ids.length) return new Map();
        return this.transaction(async tx => {
            const receipts = new Map<string, OzonBaseReceipt>();
            for (const batch of chunk(ids, OFFER_BATCH_SIZE)) {
                const rows = await tx.query(
                    `SELECT EXT_ID, CAST(PAYLOAD AS VARCHAR(4096)) AS PAYLOAD_TEXT FROM MP_EVENT WHERE SERVICE = 'OZON' AND KIND = 'PRICE_BASE' AND STATE = 'confirmed'
                     AND EXT_ID IN (${batch.map(() => '?').join(', ')})`, batch, false);
                for (const row of rows) {
                    const receipt = JSON.parse(row.PAYLOAD_TEXT);
                    receipts.set(String(row.EXT_ID), receipt);
                }
            }
            return receipts;
        });
    }

    private async changeBaseReceipt(tx: FirebirdTransaction, offer: string, receipt?: OzonBaseReceipt | null) {
        if (receipt === undefined) return;
        if (receipt === null) {
            await tx.execute("DELETE FROM MP_EVENT WHERE SERVICE = 'OZON' AND KIND = 'PRICE_BASE' AND STATE = 'confirmed' AND EXT_ID = ?", [offer], false);
        } else {
            await tx.execute(
                `UPDATE OR INSERT INTO MP_EVENT (SERVICE, KIND, EXT_ID, STATE, PAYLOAD, HANDLED_AT, LAST_SEEN)
                 VALUES ('OZON', 'PRICE_BASE', ?, 'confirmed', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 MATCHING (SERVICE, KIND, EXT_ID, STATE)`,
                [offer, journalJson(receipt)], false);
        }
    }

    async claim<T>(
        offerId: string, payload: T, stream: Stream = 'PRICE_STEP', expectedToken?: string | null, baseReceipt?: OzonBaseReceipt | null,
    ): Promise<TransitionClaim<T> | null> {
        const claim: TransitionClaim<T> = { token: randomUUID(), createdAt: new Date().toISOString(), payload };
        try {
            return await this.transaction(async tx => {
                const existing = await this.lock(tx, stream, offerId);
                if (expectedToken !== undefined && (existing?.POSTING ?? null) !== expectedToken) return null;
                if (existing && !existing.HANDLED_AT) return null;
                if (existing) {
                    await this.replace(tx, stream, offerId, claim);
                } else {
                    await tx.execute(
                        "INSERT INTO MP_EVENT (SERVICE, KIND, EXT_ID, STATE, POSTING, PAYLOAD) VALUES ('OZON', ?, ?, 'pending', ?, ?)",
                        [stream, offerId, claim.token, journalJson(claim)], false,
                    );
                }
                await this.changeBaseReceipt(tx, offerId, baseReceipt);
                return claim;
            });
        } catch (error) {
            // Два процесса могли одновременно не увидеть ещё не существующий ключ.
            // Только подтверждённый конфликт первичного ключа означает, что другой процесс стал отправителем.
            if (/violation of (?:primary|unique) key/i.test(String(error.message))) return null;
            throw error;
        }
    }

    async advance<T>(offerId: string, token: string, payload: T, stream: Stream = 'PRICE_STEP', baseReceipt?: OzonBaseReceipt | null): Promise<TransitionClaim<T> | null> {
        const claim: TransitionClaim<T> = { token: randomUUID(), createdAt: new Date().toISOString(), payload };
        return this.transaction(async tx => {
            const row = await this.lock(tx, stream, offerId);
            if (!row || row.HANDLED_AT || row.POSTING !== token) return null;
            await this.replace(tx, stream, offerId, claim);
            await this.changeBaseReceipt(tx, offerId, baseReceipt);
            return claim;
        });
    }

    async finish(offerId: string, token: string, stream: Stream = 'PRICE_STEP', notice?: PromoPriceApplyResult, baseReceipt?: OzonBaseReceipt | null): Promise<boolean> {
        return this.transaction(async tx => {
            const row = await this.lock(tx, stream, offerId);
            if (!row || row.HANDLED_AT || row.POSTING !== token) return false;
            if (notice) {
                if (stream !== 'PRICE_STEP' || notice.offerId !== offerId || notice.verification !== 'confirmed' || !notice.applied)
                    throw new Error('Для уведомления требуется подтверждённое изменение цены этого артикула');
                const receipt: TransitionClaim<TransitionNotice> = {
                    token: randomUUID(), createdAt: new Date().toISOString(), payload: { result: notice },
                };
                await tx.execute(
                    "INSERT INTO MP_EVENT (SERVICE, KIND, EXT_ID, STATE, POSTING, PAYLOAD) VALUES ('OZON', ?, ?, 'pending', ?, ?)",
                    ['PROMO_NOTICE', token, receipt.token, journalJson(receipt)], false,
                );
            }
            await tx.execute(
                `UPDATE MP_EVENT SET POSTING = ?, HANDLED_AT = CURRENT_TIMESTAMP, LAST_SEEN = CURRENT_TIMESTAMP WHERE ${scope} AND EXT_ID = ?`,
                [randomUUID(), stream, offerId], false,
            );
            await this.changeBaseReceipt(tx, offerId, baseReceipt);
            return true;
        });
    }

    private read<T>(stream: Stream, offerId?: string): Promise<Map<string, TransitionClaim<T>>> {
        return this.transaction(async tx => {
            const filter = offerId === undefined ? '' : ' AND EXT_ID = ?';
            const rows = await tx.query(
                `SELECT EXT_ID, POSTING, CHAR_LENGTH(PAYLOAD) AS PAYLOAD_LENGTH, ${payloadPart('1')} FROM MP_EVENT WHERE ${scope} AND HANDLED_AT IS NULL${filter}`,
                offerId === undefined ? [stream] : [stream, offerId], false,
            );
            const result = new Map<string, TransitionClaim<T>>();
            for (const row of rows) {
                let raw = row.PART;
                for (let start = PAYLOAD_PART_SIZE + 1; start <= row.PAYLOAD_LENGTH; start += PAYLOAD_PART_SIZE) {
                    const [next] = await tx.query(
                        `SELECT ${payloadPart('CAST(? AS INTEGER)')} FROM MP_EVENT
                         WHERE ${scope} AND EXT_ID = ? AND POSTING = ? AND HANDLED_AT IS NULL`,
                        [start, stream, row.EXT_ID, row.POSTING], false,
                    );
                    if (!next) throw new Error(`Квитанция Ozon для ${row.EXT_ID} изменилась во время чтения`);
                    raw += next.PART;
                }
                const claim: TransitionClaim<T> = JSON.parse(raw);
                if (!claim || !claim.token || claim.token !== row.POSTING || !claim.createdAt || !('payload' in claim)) {
                    throw new Error(`Повреждена квитанция Ozon для ${row.EXT_ID}`);
                }
                result.set(String(row.EXT_ID), claim);
            }
            return result;
        });
    }

    private async lock(tx: FirebirdTransaction, stream: Stream, offerId: string) {
        const [row] = await tx.query(
            `SELECT POSTING, HANDLED_AT FROM MP_EVENT WHERE ${scope} AND EXT_ID = ? WITH LOCK`, [stream, offerId], false,
        );
        return row;
    }

    private replace<T>(tx: FirebirdTransaction, stream: Stream, offerId: string, claim: TransitionClaim<T>) {
        return tx.execute(
            `UPDATE MP_EVENT SET POSTING = ?, PAYLOAD = ?, HANDLED_AT = NULL, LAST_SEEN = CURRENT_TIMESTAMP WHERE ${scope} AND EXT_ID = ?`,
            [claim.token, journalJson(claim), stream, offerId], false,
        );
    }

    private async transaction<T>(fn: (tx: FirebirdTransaction) => Promise<T>): Promise<T> {
        const tx = await this.pool.getTransaction(ISOLATION_READ_COMMITTED);
        try {
            const value = await fn(tx);
            await tx.commit(true);
            return value;
        } catch (error) {
            await tx.rollback(true).catch(() => undefined);
            throw error;
        }
    }
}
