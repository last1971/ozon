import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { FirebirdTransaction } from 'ts-firebird';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { IReturnStock, RETURN_STOCK } from '../interfaces/i.return.stock';
import { MP_SERVICE_NAME, MpService } from '../mp-event/mp-event.service';
import { MpReturnAcceptStore } from '../mp-event/mp-return-accept.store';
import { parseReturnScan } from '../helpers/return-scan.parser';
import { writeOffSpis } from './commands/return.contexts';
import { inTransaction } from '../helpers/transaction';
import { NotifyTopic } from '../notify/notify.types';
import { IReturnSource, RETURN_SOURCES } from './sources/i.return.source';
import { ReturnCardBuilder } from './return-card.builder';
import { MpReturnChainFactory } from './mp-return.chain.factory';
import { ReturnRefusedError } from './return-refused.error';
import { returnRowStatus } from './assess-return-line';
import { ReturnLineDto } from './dto/return-line.dto';
import { ReturnCardDto, ReturnRowDto } from './dto/return-card.dto';
import { AcceptReturnDto, ReturnActionResultDto, WriteOffReturnDto } from './dto/return-request.dto';
import { AcceptContext } from './commands/return.contexts';
import { MarkScanPool } from './mark-scan.pool';

/** Блокировка записи кроном возвратов (раз в 5 минут правит те же коды). */
const LOCK_ERROR = /deadlock|lock conflict|concurrent update/i;
/** Список по умолчанию — за последние 14 дней (решение владельца 15.10). */
const DEFAULT_DAYS = 14;

/**
 * Экран приёма возвратов: список, поиск по скану, приём/проблема, списание.
 * Сервис держит транзакцию и переводит ошибки на язык кладовщика; что делать по шагам —
 * знает фабрика цепочек, можно ли — оценка строки возврата.
 */
@Injectable()
export class MpReturnService {
    private readonly logger = new Logger(MpReturnService.name);
    private readonly sources: Map<MpService, IReturnSource>;

    constructor(
        @Inject(RETURN_SOURCES) sources: IReturnSource[],
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        @Inject(RETURN_STOCK) private readonly stock: IReturnStock,
        private readonly builder: ReturnCardBuilder,
        private readonly store: MpReturnAcceptStore,
        private readonly factory: MpReturnChainFactory,
        private readonly eventEmitter: EventEmitter2,
    ) {
        this.sources = new Map(sources.map((s) => [s.service, s]));
    }

    async list(service: MpService, from?: string, to?: string, onlyPending = true): Promise<ReturnRowDto[]> {
        const source = this.source(service);
        const start = from
            ? DateTime.fromISO(from).startOf('day')
            : DateTime.now().minus({ days: DEFAULT_DAYS }).startOf('day');
        const end = (to ? DateTime.fromISO(to) : DateTime.now()).plus({ days: 1 }).startOf('day');
        if (!start.isValid || !end.isValid) throw new BadRequestException('Неверный период');
        const lines = await source.listReceived(start.toJSDate(), end.toJSDate());
        const rows = await this.read(async (t) => {
            const records = new Map(
                (
                    await this.store.findMany(
                        service,
                        lines.map((l) => l.extId),
                        t,
                    )
                ).map((r) => [r.extId, r]),
            );
            const result: ReturnRowDto[] = [];
            for (const line of lines) {
                const card = await this.builder.build(line, t, records.get(line.extId) ?? null);
                result.push({
                    line,
                    invoiceNumber: card.invoice?.number ?? null,
                    goodsName: card.invoiceLine?.name ?? line.productName,
                    quan: card.quan,
                    status: returnRowStatus(card.accepted, card.blockers),
                    blockers: card.blockers,
                    warnings: card.warnings,
                });
            }
            return result;
        });
        return onlyPending ? rows.filter((r) => r.status === 'pending' || r.status === 'blocked') : rows;
    }

    async lookup(service: MpService, q: string): Promise<ReturnCardDto[]> {
        const scan = parseReturnScan(q);
        if (!scan)
            throw new BadRequestException(
                `Не распознано: «${q}». Нужна этикетка или стикер возврата, номер отправления или заказа`,
            );
        const lines = await this.source(service).find(scan);
        if (!lines.length) {
            throw new NotFoundException(
                scan.kind === 'barcode'
                    ? `Возврат ${scan.value} не найден. Если ${MP_SERVICE_NAME[service]} ещё не отметил посылку — повторите через 5 минут или введите номер отправления`
                    : `Возврат по «${scan.value}» не найден — возможно, посылка другого кабинета`,
            );
        }
        // По очереди, как в list(): параллельные запросы на одной транзакции Firebird молча виснут
        // (отправление с 25 возвратами не отвечало вовсе, 16.10.2026).
        return this.read(async (t) => {
            const cards: ReturnCardDto[] = [];
            for (const line of lines) cards.push(await this.builder.build(line, t));
            return cards;
        });
    }

    /**
     * Решение кладовщика по одному или нескольким возвратам (вся посылка одной кнопкой).
     * Та же цепочка по каждому возврату по очереди в одной транзакции; марки — общий пул кнопки.
     * Отказ по любому возврату откатывает все.
     */
    async accept(service: MpService, dto: AcceptReturnDto): Promise<ReturnActionResultDto> {
        const lines = await this.resolveLines(service, [...new Set(dto.extIds)], dto.posting);
        const marks = new MarkScanPool(dto.scans ?? []);
        const done = await this.write(async (t) => {
            const result: AcceptContext[] = [];
            for (const line of lines) {
                const ctx = await this.factory
                    .forAction(dto.action)
                    .execute({
                        t,
                        line,
                        action: dto.action,
                        username: dto.username.trim(),
                        marks,
                        comment: dto.comment?.trim() || null,
                        osnSpisId: dto.osnSpisId ?? null,
                        kis: [],
                        retiredKis: [],
                    })
                    .catch((e) => {
                        if (lines.length > 1 && e instanceof ReturnRefusedError) {
                            throw new ReturnRefusedError(`Возврат ${line.extId} (${line.offerId}): ${e.message}`);
                        }
                        throw e;
                    });
                result.push(ctx);
            }
            marks.assertAllUsed();
            return result;
        });
        this.notifyAccepted(done);
        return { ok: true, message: this.acceptMessage(done) };
    }

    async writeOff(service: MpService, extId: string, dto: WriteOffReturnDto): Promise<ReturnActionResultDto> {
        this.source(service);
        const result = await this.write(async (t) => {
            const rec = await this.store.find(service, extId, t);
            if (!rec || rec.decision !== 'RETURN')
                throw new ReturnRefusedError('Списать можно только принятый возврат');
            const doc = {
                goodscode: rec.goodscode,
                quan: rec.quan,
                username: dto.username.trim(),
                osnSpisId: dto.osnSpisId,
                comment: dto.comment?.trim() || null,
                posting: rec.posting ?? '',
            };
            return this.factory
                .writeOff()
                .execute({ t, service, extId, kis: rec.kis, ...doc, spis: writeOffSpis(doc) });
        });
        this.eventEmitter.emit(
            'error.message',
            'Списан возврат',
            `${result.posting}: ${result.quan} шт, документ списания ${result.spisCode}, списал ${result.username}`,
            NotifyTopic.OPS,
        );
        return { ok: true, message: `Списано ${result.quan} шт, документ ${result.spisCode}` };
    }

    reasons(): Promise<{ id: number; name: string }[]> {
        return this.stock.listWriteOffReasons();
    }

    private source(service: MpService): IReturnSource {
        const source = this.sources.get(service);
        if (!source) throw new BadRequestException(`Возвраты ${service} пока не поддержаны`);
        return source;
    }

    /**
     * Строки возвратов по id. Отправление известно — одним поиском по нему (там же найденные живьём,
     * которых в журнале ещё нет), остальные — по id.
     */
    private async resolveLines(service: MpService, extIds: string[], posting?: string): Promise<ReturnLineDto[]> {
        const source = this.source(service);
        const byPosting = posting ? await source.find({ kind: 'posting', value: posting }) : [];
        const lines: ReturnLineDto[] = [];
        for (const extId of extIds) {
            const line =
                byPosting.find((l) => l.extId === extId) ?? (await source.find({ kind: 'extId', value: extId }))[0];
            if (!line) throw new NotFoundException(`Возврат ${extId} не найден`);
            lines.push(line);
        }
        return lines;
    }

    private read<T>(fn: (t: FirebirdTransaction) => Promise<T>): Promise<T> {
        return inTransaction(() => this.invoiceService.getTransaction(), fn);
    }

    /** Одна транзакция на кнопку: любой отказ или сбой — откат целиком, кладовщику — понятный текст. */
    private async write<T>(fn: (t: FirebirdTransaction) => Promise<T>): Promise<T> {
        try {
            return await this.read(fn);
        } catch (e) {
            if (e instanceof ReturnRefusedError) throw new BadRequestException(e.message);
            const text = String(e?.message ?? e);
            if (LOCK_ERROR.test(text)) {
                throw new ConflictException('Запись занята автоматикой возвратов — повторите через минуту');
            }
            this.logger.error(`Приём возврата: ${text}`);
            throw e;
        }
    }

    private acceptMessage(done: AcceptContext[]): string {
        const s = summarizeAccepted(done);
        if (s.action === 'problem')
            return done.length > 1 ? `Отмечено проблемой: ${done.length}` : 'Отмечено проблемой';
        const counted = done.length > 1 ? ` (возвратов ${done.length})` : '';
        const base = `Принято ${s.quan} шт${counted}, счёт №${s.invoices.join(', №')}`;
        return s.spisCodes.length ? `${base}; списано, ${docsText(s.spisCodes)}` : base;
    }

    /** После commit — замыкание, не шаг цепочки: при откате уведомлять не о чем. Одно уведомление на кнопку. */
    private notifyAccepted(done: AcceptContext[]): void {
        const s = summarizeAccepted(done);
        const { line, username, comment } = done[0];
        if (s.action === 'problem') {
            this.eventEmitter.emit(
                'error.message',
                'Проблема с возвратом',
                `${s.heads.join('\n')}\nПричина покупателя: ${line.reason ?? '—'}\nКладовщик (${username}): ${comment}`,
                NotifyTopic.OPS,
            );
            return;
        }
        const parts = [`${s.heads.join('\n')}, принял ${username}`];
        if (s.spisCodes.length) parts.push(`Списан: ${docsText(s.spisCodes)}`);
        if (s.retiredKis.length && !s.spisCodes.length) {
            parts.push(`Вернуть в оборот в Честном знаке (${s.retiredKis.length}):\n${s.retiredKis.join('\n')}`);
        }
        this.eventEmitter.emit('error.message', 'Принят возврат', parts.join('\n'), NotifyTopic.OPS);
    }
}

/** Сводка кнопки: строки «отправление: счёт, товар — N шт» по товару, документы списания, коды в оборот. */
function summarizeAccepted(done: AcceptContext[]) {
    const heads = new Map<string, { text: string; quan: number; count: number }>();
    for (const { line, card } of done) {
        const goods = card.invoiceLine?.name ?? line.productName ?? line.offerId;
        const text = `${line.posting}: счёт №${card.invoice?.number ?? '?'}, ${goods}`;
        const head = heads.get(text) ?? { text, quan: 0, count: 0 };
        head.quan += card.quan;
        head.count += 1;
        heads.set(text, head);
    }
    return {
        action: done[0].action,
        quan: done.reduce((sum, c) => sum + c.card.quan, 0),
        invoices: [...new Set(done.map((c) => c.card.invoice?.number ?? '?'))],
        heads: [...heads.values()].map(
            (h) => `${h.text} — ${h.quan} шт${h.count > 1 ? ` (возвратов ${h.count})` : ''}`,
        ),
        spisCodes: done.map((c) => c.writeOff?.spisCode).filter((c) => c != null),
        retiredKis: done.flatMap((c) => c.retiredKis),
    };
}

const docsText = (codes: number[]): string =>
    codes.length === 1 ? `документ ${codes[0]}` : `документы ${codes.join(', ')}`;
