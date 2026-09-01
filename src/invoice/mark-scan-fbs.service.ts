import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebirdTransaction } from 'ts-firebird';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { InvoiceDto } from './dto/invoice.dto';
import { MarkScanProgressDto } from './dto/mark-scan-progress.dto';
import { MarkScanProgressLineDto } from './dto/mark-scan-progress-line.dto';
import { MarkScanResultDto } from './dto/mark-scan-result.dto';
import { extractKi, isMarkCodesEnabled } from '../helpers';
import { InvoiceMatchDto } from './dto/invoice.match.dto';

@Injectable()
export class MarkScanFbsService {
    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
    ) {}

    private isEnabled(): boolean {
        return isMarkCodesEnabled(this.configService);
    }

    /**
     * Гейт на входе в скан и в подбор: счёт отменён маркетплейсом — работать по нему нельзя.
     *
     * Коды здесь НЕ трогаем. Их состояние уже привела в порядок автоматика отмены:
     * при `STATUS=3` она их отвязала совсем, при `STATUS=4` сняла только `TT`
     * (`MARKCODE_RETURN_TO_STOCK`), оставив привязку к строке — именно по ней Дельфи
     * при расформировании потребует отсканировать содержимое коробки. Снять их здесь
     * значило бы лишить кладовщика этой проверки: расформирование прошло бы молча.
     */
    async assertLive(match: InvoiceMatchDto): Promise<void> {
        if (!match?.cancelled && !match?.closed) return;
        if (match.cancelled) {
            throw new ConflictException(
                `Счёт отменён маркетплейсом (${match.mark.trim()}). Товар в отгрузку не отдавать. ` +
                    `Если посылка собрана — расформируйте счёт ${match.invoice.id} в Trade и отсканируйте коды.`,
            );
        }
        throw new ConflictException(`Счёт оплачен и закрыт (${match.mark.trim()}), работа по нему запрещена.`);
    }

    /**
     * Снять все КМ со счёта тем же путём, что кнопка «отвязать последний»
     * (`MARKCODE_DETACH_FOR_FBS`), только по всем кодам счёта сразу.
     * Возвращает, сколько отвязано.
     *
     * @param t внешняя транзакция. Передана — работаем в ней и НЕ коммитим:
     *          вызывающий (отмена в кроне) складывает отвязку, суффикс и статус
     *          в одну транзакцию, иначе можно получить «статус сменили, а коды
     *          остались». Ошибка при этом уходит наверх как есть, чтобы откатился
     *          весь элемент целиком.
     */
    async detachAll(invoice: InvoiceDto, t: FirebirdTransaction = null): Promise<number> {
        if (t) {
            const codes = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, t);
            const ss = this.invoiceService.getStorageSS();
            for (const code of codes) {
                await this.invoiceService.detachMarkCodeForFbs(code.ki, code.realpricecode, ss, t);
            }
            return codes.length;
        }
        const transaction = await this.invoiceService.getTransaction();
        try {
            const codes = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, transaction);
            const ss = this.invoiceService.getStorageSS();
            for (const code of codes) {
                await this.invoiceService.detachMarkCodeForFbs(code.ki, code.realpricecode, ss, transaction);
            }
            await transaction.commit(true);
            return codes.length;
        } catch (e) {
            await transaction.rollback(true).catch(() => undefined);
            throw new ConflictException(`Счёт отменён, но коды отвязать не удалось: ${e?.message}`);
        }
    }

    async scan(invoice: InvoiceDto, rawScan: string): Promise<MarkScanResultDto> {
        if (!this.isEnabled()) throw new ConflictException('Сканирование КМ отключено');
        const ki = extractKi(rawScan);
        const transaction = await this.invoiceService.getTransaction();
        try {
            const info = await this.invoiceService.getMarkCodeInfoByKi(ki, transaction);
            if (!info) {
                await transaction.rollback(true);
                throw new NotFoundException('КМ не найден в базе');
            }
            const rpc = await this.pickTargetRpc(invoice.id, info.goodscode, info.quantity, transaction);
            const ss = this.invoiceService.getStorageSS();
            await this.invoiceService.attachMarkCodeForFbs(ki, rpc, info.goodscode, ss, rawScan.trim(), transaction);
            await transaction.commit(true);
            return {
                attached: { ki, goodscode: info.goodscode, realpricecode: rpc },
                progress: await this.getProgress(invoice),
            };
        } catch (e) {
            await transaction.rollback(true).catch(() => undefined);
            if (e instanceof NotFoundException || e instanceof ConflictException) throw e;
            throw new ConflictException(e?.message || 'Не удалось привязать КМ');
        }
    }

    async unscan(invoice: InvoiceDto, ki: string): Promise<MarkScanProgressDto> {
        if (!this.isEnabled()) throw new ConflictException('Сканирование КМ отключено');
        // Счёт подобран → отвязка КМ запрещена (подбор увёл счёт со статуса сборки).
        if (await this.invoiceService.isPickedUp(invoice, null)) {
            throw new ConflictException('Счёт подобран — отвязка КМ запрещена');
        }
        const attached = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, null);
        const row = attached.find((a) => a.ki === ki);
        if (!row) throw new NotFoundException('КМ не привязан к этому счёту');
        const transaction = await this.invoiceService.getTransaction();
        try {
            const ss = this.invoiceService.getStorageSS();
            await this.invoiceService.detachMarkCodeForFbs(ki, row.realpricecode, ss, transaction);
            await transaction.commit(true);
        } catch (e) {
            await transaction.rollback(true).catch(() => undefined);
            throw new ConflictException(e?.message || 'Не удалось отвязать КМ');
        }
        return this.getProgress(invoice);
    }

    async getProgress(invoice: InvoiceDto): Promise<MarkScanProgressDto> {
        if (!this.isEnabled()) {
            return { lines: [], isReadyToFinish: true, attachedKis: [], isPickedUp: false };
        }
        const pickedUp = await this.invoiceService.isPickedUp(invoice, null);
        const transaction = await this.invoiceService.getTransaction();
        try {
            const lines = await this.invoiceService.getRealpriceLinesByScode(invoice.id, transaction);
            const attached = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, transaction);

            const uniqueGc = Array.from(new Set(lines.map((l) => l.goodscode)));
            const freeByGc = new Map<string, number>();
            for (const gc of uniqueGc) {
                freeByGc.set(gc, await this.invoiceService.countFreeMarkCodesForGood(gc, transaction));
            }

            // штуки (SUM QUANTITY), не число кодов: количественный КМ покрывает N штук
            const scannedByRpc = new Map<number, number>();
            for (const a of attached) {
                scannedByRpc.set(a.realpricecode, (scannedByRpc.get(a.realpricecode) ?? 0) + a.quantity);
            }
            const scannedByGc = new Map<string, number>();
            for (const a of attached) {
                scannedByGc.set(a.goodscode, (scannedByGc.get(a.goodscode) ?? 0) + a.quantity);
            }

            const progressLines: MarkScanProgressLineDto[] = lines.map((line) => {
                const free = freeByGc.get(line.goodscode) ?? 0;
                const totalScannedForGc = scannedByGc.get(line.goodscode) ?? 0;
                const requiresScan = free + totalScannedForGc >= line.quantity;
                const quantityScanned = scannedByRpc.get(line.realpricecode) ?? 0;
                return {
                    realpricecode: line.realpricecode,
                    goodscode: line.goodscode,
                    quantityNeeded: line.quantity,
                    quantityScanned,
                    requiresScan,
                    isComplete: !requiresScan || quantityScanned >= line.quantity,
                };
            });

            return {
                lines: progressLines,
                isReadyToFinish: progressLines.every((l) => l.isComplete),
                attachedKis: attached.map((a) => a.ki),
                isPickedUp: pickedUp,
            };
        } finally {
            await transaction.commit(true).catch(() => undefined);
        }
    }

    async isReadyToFinish(invoice: InvoiceDto): Promise<boolean> {
        return (await this.getProgress(invoice)).isReadyToFinish;
    }

    /**
     * Строка счёта под сканируемый код.
     *
     * Позиция маркетплейса продаётся юнитами, и Озон ждёт РОВНО ОДИН экземпляр на юнит:
     * у пачечного артикула (552601-3) юнит закрывается одним кодом на 3 шт, у штучного —
     * тремя кодами по 1 шт. Поэтому строка выбирается по ФАСОВКЕ (`PIECES`), а не по тому,
     * влезает ли код в остаток штук: иначе штучный код садится в пачечную строку, и
     * правильный код на 3 шт потом деть некуда — сборка встаёт при полном комплекте кодов.
     *
     * `PIECES = null` — строка создана до появления поля: работаем по-старому (по остатку
     * штук), иначе бы встали все счета, живущие на момент выката.
     */
    private async pickTargetRpc(
        scode: number,
        goodscode: string,
        codeQty: number,
        transaction: FirebirdTransaction,
    ): Promise<number> {
        const lines = await this.invoiceService.getRealpriceLinesByScode(scode, transaction);
        const matching = lines.filter((l) => l.goodscode === goodscode);
        if (matching.length === 0) {
            throw new ConflictException('КМ не для товаров этого заказа');
        }
        const attached = await this.invoiceService.getAttachedMarkCodesByScode(scode, transaction);
        const scannedByRpc = new Map<number, number>();
        for (const a of attached) {
            scannedByRpc.set(a.realpricecode, (scannedByRpc.get(a.realpricecode) ?? 0) + a.quantity);
        }
        // код неделим: его QUANTITY должно целиком поместиться в остаток строки
        const remainingOf = (l: { realpricecode: number; quantity: number }) =>
            l.quantity - (scannedByRpc.get(l.realpricecode) ?? 0);
        // != null: и null (нет данных из базы), и undefined (строка собрана без поля)
        const known = matching.filter((l) => l.pieces != null);
        // Фасовка известна хотя бы у одной строки — решаем по ней. Остальные строки этого
        // товара со старой (пустой) фасовкой в выбор не берём: там фасовка неизвестна, а
        // не «любая», и код мог бы уехать в чужую позицию.
        if (known.length > 0) {
            const fitting = known.filter((l) => l.pieces === codeQty);
            if (fitting.length === 0) {
                const sizes = Array.from(new Set(known.map((l) => l.pieces))).sort((a, b) => a - b);
                throw new ConflictException(
                    `Код на ${codeQty} шт не подходит позициям этого товара (фасовка ${sizes.join(', ')} шт) — ` +
                        'поделите код (MARKCODE_SPLIT / деление в ЛК ЧЗ)',
                );
            }
            // Строки с одинаковой фасовкой взаимозаменяемы (Озон дробит позицию по ценам) —
            // берём первую незакрытую.
            const target = fitting.find((l) => remainingOf(l) >= codeQty);
            if (!target) {
                throw new ConflictException('Лимит КМ для этого товара исчерпан');
            }
            return target.realpricecode;
        }
        const target = matching.find((l) => remainingOf(l) >= codeQty);
        if (!target) {
            const maxRemaining = Math.max(...matching.map(remainingOf));
            if (maxRemaining <= 0) {
                throw new ConflictException('Лимит КМ для этого товара исчерпан');
            }
            throw new ConflictException(
                `Код на ${codeQty} шт не помещается в остаток строки (свободно ${maxRemaining} шт) — ` +
                    'поделите код (MARKCODE_SPLIT / деление в ЛК ЧЗ)',
            );
        }
        return target.realpricecode;
    }
}
