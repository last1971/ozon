import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FirebirdTransaction } from 'ts-firebird';
import { inTransaction } from '../helpers/transaction';
import { goodQuantityCoeff } from '../helpers/product/product.helpers';
import { SupplyQrRecord, SupplyQrStore } from './supply-qr.store';
import { fillQr, offerGoodscode, readTemplate, TemplateLine, templateBoxes } from './supply-template';
import { classifyScan, gtinVariants, kiOf, markRefusal, matchLines, normalizeQr } from './supply-scan.rules';
import {
    BindQrDto,
    ResolvedProductDto,
    ResolveProductDto,
    SupplyBoundDto,
    SupplyLineDto,
    SupplyTemplateDto,
} from './dto/supply-qr.dto';

/** Что отсканировали как товар — после всех проверок. */
interface Resolved {
    goodscode: number;
    name: string | null;
    offers: TemplateLine[];
    markcode: number | null;
    ki: string | null;
}

const UNIQUE = /violation of PRIMARY or UNIQUE KEY/i;

/**
 * QR-этикетки экземпляров поставки FBO Озона (размещение в ПВЗ): шаблон Озона → привязка
 * «этикетка ii… + товар» по коробкам → тот же шаблон с заполненным QR. План ~/.claude/plans/ozon-fbo-supply-qr.md.
 * Состав коробок живёт в файле Озона (экран присылает его со сканом), в базе — только привязки.
 */
@Injectable()
export class SupplyQrService {
    constructor(private readonly store: SupplyQrStore) {}

    async template(buffer: Buffer): Promise<SupplyTemplateDto> {
        const { rows } = await this.parse(buffer);
        const boxes = templateBoxes(rows);
        return this.run(async (t) => {
            const codes = [
                ...new Set(boxes.flatMap((b) => b.lines.map((l) => l.goodscode)).filter((gc) => gc !== null)),
            ];
            const names = await this.store.names(codes, t);
            const bound = await this.store.byCargo(
                boxes.map((b) => b.cargoId),
                t,
            );
            return {
                boxes: boxes.map((b) => ({
                    ...b,
                    lines: b.lines.map((l) => ({
                        ...l,
                        name: l.goodscode === null ? null : (names.get(l.goodscode) ?? null),
                    })),
                })),
                bound: bound.map(toBound),
            };
        });
    }

    /** Скан товара до наклейки этикетки: есть ли он в коробке и можно ли его отправить. */
    async resolve(dto: ResolveProductDto): Promise<ResolvedProductDto> {
        return this.run(async (t) => {
            const r = await this.resolveIn(dto, t);
            return { goodscode: r.goodscode, name: r.name, offerIds: r.offers.map((l) => l.offerId), ki: r.ki };
        });
    }

    /** Скан этикетки: свободна ли она. */
    async qr(raw: string): Promise<SupplyBoundDto | null> {
        const qr = this.assertQr(raw);
        return this.run(async (t) => {
            const rec = await this.store.byQr(qr, t);
            return rec ? toBound(rec) : null;
        });
    }

    /** Пара «этикетка + товар» собрана — записать. Все проверки повторяются в транзакции записи. */
    async bind(dto: BindQrDto): Promise<SupplyBoundDto> {
        const qr = this.assertQr(dto.qr);
        return this.run(async (t) => {
            const used = await this.store.byQr(qr, t);
            if (used) throw refused(`Этикетка ${qr} уже наклеена: коробка ${used.cargoId}, артикул ${used.offerId}`);
            const r = await this.resolveIn(dto, t);
            const line = dto.offerId
                ? r.offers.find((l) => l.offerId === dto.offerId)
                : r.offers.length === 1
                  ? r.offers[0]
                  : null;
            if (!line)
                throw refused(
                    dto.offerId
                        ? `Артикул ${dto.offerId} не подходит к отсканированному товару`
                        : `Товар подходит к нескольким артикулам коробки (${r.offers.map((l) => l.offerId).join(', ')}) — выберите`,
                );
            const done = await this.store.countBound(dto.cargoId, line.offerId, t);
            if (done >= line.need)
                throw refused(`По артикулу ${line.offerId} в коробке уже набрано ${done} из ${line.need}`);
            await this.store
                .insert(
                    {
                        qr,
                        cargoId: dto.cargoId,
                        offerId: line.offerId,
                        ozonBarcode: line.ozonBarcode || null,
                        goodscode: r.goodscode,
                        markcode: r.markcode,
                        scanRaw: dto.scan,
                        username: dto.username,
                    },
                    t,
                )
                .catch((e) => {
                    if (UNIQUE.test(String(e?.message ?? e)))
                        throw refused('Этикетка или код ЧЗ уже привязаны — обновите экран');
                    throw e;
                });
            return toBound((await this.store.byQr(qr, t)) as SupplyQrRecord);
        });
    }

    async unbind(raw: string): Promise<void> {
        const qr = this.assertQr(raw);
        const deleted = await this.run((t) => this.store.delete(qr, t));
        if (!deleted) throw new NotFoundException(`Этикетка ${qr} не привязана`);
    }

    /** Тот же файл Озона с заполненным столбцом QR и сколько строк в нём осталось пустыми. */
    async export(buffer: Buffer): Promise<{ file: Buffer; empty: number }> {
        const { wb, ws, rows } = await this.parse(buffer);
        const bound = await this.run((t) => this.store.byCargo([...new Set(rows.map((r) => r.cargoId))], t));
        const empty = fillQr(ws, rows, bound);
        return { file: Buffer.from(await wb.xlsx.writeBuffer()), empty };
    }

    private async resolveIn(dto: ResolveProductDto, t: FirebirdTransaction): Promise<Resolved> {
        const lines = toLines(dto.lines);
        const scan = dto.scan.trim();

        // Штрихкод Озона с карточки (OZN…) — сразу артикул коробки.
        const byOzon = lines.filter((l) => l.ozonBarcode && l.ozonBarcode === scan);
        if (byOzon.length && byOzon[0].goodscode !== null) {
            const gc = byOzon[0].goodscode;
            return { goodscode: gc, name: await this.name(gc, t), offers: byOzon, markcode: null, ki: null };
        }

        if (/^OZN\d+$/i.test(scan)) throw refused(`Штрихкод Озона ${scan} не из коробки ${dto.cargoId}`);

        const kind = classifyScan(scan);
        if (kind === 'qr') throw refused('Это этикетка Озона, а нужен товар');
        if (kind === 'cargo') throw refused('Это этикетка коробки, а нужен товар');
        if (kind === 'unknown')
            throw refused(`Не понял скан «${scan.slice(0, 40)}» — нужен штрихкод товара или код ЧЗ`);

        let goodscodes: number[];
        let quantity: number | null = null;
        let markcode: number | null = null;
        let ki: string | null = null;
        if (kind === 'km') {
            ki = kiOf(scan);
            const mark = await this.store.markByKi(ki, t);
            if (!mark) throw refused('Код ЧЗ не найден в нашей базе — чужой код');
            const why = markRefusal(mark);
            if (why) throw refused(`Нельзя отправить: ${why}`);
            const bound = await this.store.byMarkcode(mark.markcode, t);
            if (bound) throw refused(`К этому коду ЧЗ уже наклеена этикетка ${bound.qr} (коробка ${bound.cargoId})`);
            goodscodes = [mark.goodscode];
            quantity = mark.quantity;
            markcode = mark.markcode;
        } else {
            goodscodes = await this.store.goodsByGtin(gtinVariants(scan), t);
            if (!goodscodes.length) throw refused(`Штрихкод ${scan} не найден в базе`);
        }

        const offers = matchLines(lines, goodscodes, quantity);
        if (!offers.length) {
            const sameGood = matchLines(lines, goodscodes, null);
            if (sameGood.length && quantity !== null)
                throw refused(
                    `Код ЧЗ на ${quantity} шт, а в коробке фасовка ${sameGood.map((l) => `${l.offerId} (${l.pieces} шт)`).join(', ')}`,
                );
            const names = await this.store.names(goodscodes, t);
            const what = goodscodes.map((gc) => `${gc} ${names.get(gc) ?? ''}`.trim()).join('; ');
            throw refused(`Этого товара нет в коробке ${dto.cargoId}: ${what}`);
        }
        const gc = offers[0].goodscode as number;
        return { goodscode: gc, name: await this.name(gc, t), offers, markcode, ki };
    }

    private async name(gc: number, t: FirebirdTransaction): Promise<string | null> {
        return (await this.store.names([gc], t)).get(gc) ?? null;
    }

    private assertQr(raw: string): string {
        const qr = normalizeQr(raw ?? '');
        if (classifyScan(qr) !== 'qr') throw refused(`«${qr.slice(0, 40)}» — не этикетка Озона ii…`);
        return qr;
    }

    private async parse(buffer: Buffer) {
        if (!buffer?.length) throw refused('Файл не получен');
        try {
            return await readTemplate(buffer);
        } catch (e) {
            throw refused(`Не прочитал файл Озона: ${e?.message ?? e}`);
        }
    }

    private run<T>(fn: (t: FirebirdTransaction) => Promise<T>): Promise<T> {
        return inTransaction(() => this.store.transaction(), fn);
    }
}

function refused(message: string): BadRequestException {
    return new BadRequestException(message);
}

function toLines(lines: SupplyLineDto[]): TemplateLine[] {
    return lines.map((l) => ({
        offerId: l.offerId.trim(),
        ozonBarcode: (l.ozonBarcode ?? '').trim(),
        goodscode: offerGoodscode(l.offerId.trim()),
        pieces: goodQuantityCoeff({ offer_id: l.offerId.trim() }),
        need: l.need,
    }));
}

function toBound(r: SupplyQrRecord): SupplyBoundDto {
    return {
        qr: r.qr,
        cargoId: r.cargoId,
        offerId: r.offerId,
        goodscode: r.goodscode,
        ki: r.ki,
        username: r.username,
        createdAt: r.createdAt.toISOString(),
    };
}
