import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FirebirdTransaction } from 'ts-firebird';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';

/** Строка донора: подборка и строка счёта, откуда едет товар. */
export interface DonorLineRef {
    podbposcode: number;
    scode: number;
    realpricecode: number;
}

/** Куда едет: строка счёта-приёмника, товар, номинал кода на строке, отправление (для аудита). */
export interface TransferTarget {
    scode: number;
    realpricecode: number;
    goodscode: string;
    nominal: number;
    posting: string;
}

export interface TransferResult {
    moved: number; // штук переехало подборкой (0 — все коды кандидата застряли, подборку не трогали)
    codes: string[]; // КИ, переехавшие вместе с товаром
    stuck: number; // кодов застряло на доноре (их штуки остались там же)
}

/** Перенос подборки не прошёл: уехавшие коды возвращены (кроме orphaned — они повисли на приёмнике). */
export class DonorTransferError extends Error {
    constructor(
        message: string,
        readonly donor: DonorLineRef,
        readonly orphaned: string[],
    ) {
        super(message);
    }
}

/**
 * Единственная точка переноса товара с донора на строку счёта: сначала коды маркировки
 * (целые, строго номинала строки, MARKCODE_MIGRATE), потом подборка (PODBPOS_MIGRATE_QTY),
 * потом запись в аудит FBO_MIGRATION_LINK. Порядок обязателен: декремент подборки не
 * освобождает FIFO, пока кодовые резервы живы на строке донора. Всё в транзакции вызывающего.
 * Ею пользуются автоматика FBO (FboMarkMigrationService) и ручной разбор недобора (DonorApplyService):
 * решает, с кого и сколько брать, вызывающий; как везти — только здесь.
 */
@Injectable()
export class DonorTransferService {
    private readonly logger = new Logger(DonorTransferService.name);

    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async transfer(donor: DonorLineRef, take: number, target: TransferTarget, t: FirebirdTransaction): Promise<TransferResult> {
        const { goodscode: gc, nominal } = target;
        const s_s = this.invoiceService.getStorageSS();
        let rest = take;
        let stuck = 0;

        // 1) Коды: целые, только номинала строки, TT=3 вперёд (порядок задаёт выборка).
        const migrated: string[] = [];
        const codes = await this.invoiceService.findLiveMigratableCodes(donor.realpricecode, nominal, t);
        for (const code of codes.slice(0, Math.floor(take / nominal))) {
            try {
                await this.invoiceService.migrateMarkCode(code.ki, donor.realpricecode, target.realpricecode, gc, s_s, t);
                migrated.push(code.ki);
            } catch (e) {
                // Код застрял (гонка, параллельная ручная операция, кривые данные): его штуки
                // остаются на доноре вместе с ним, иначе код повисает без товара и партийный учёт задваивается.
                rest -= nominal;
                stuck++;
                this.logger.warn(`FBO migration: КМ ${code.ki} не переехал (RPC ${donor.realpricecode} -> ${target.realpricecode}): ${e.message}`);
            }
        }
        if (rest <= 0) return { moved: 0, codes: migrated, stuck };

        // 2) Подборка: донор минус, приёмник плюс, атомарной SP.
        try {
            await this.invoiceService.migratePodbpos(donor.podbposcode, target.scode, target.realpricecode, gc, rest, t);
        } catch (e) {
            // Перенос штук не прошёл (гонка/партийный учёт) — возвращаем уже переехавшие коды назад.
            this.logger.warn(`FBO migration: перенос подборки не прошёл (PODBPOS ${donor.podbposcode}, take=${rest}): ${e.message}`);
            const orphaned: string[] = [];
            for (const ki of migrated) {
                try {
                    await this.invoiceService.migrateMarkCode(ki, target.realpricecode, donor.realpricecode, gc, s_s, t);
                } catch (e2) {
                    orphaned.push(ki);
                    this.eventEmitter.emit(
                        'error.message',
                        'FBO migration: КМ завис на счёте продажи без подборки — нужен ручной разбор',
                        `КМ ${ki}, GOODSCODE ${gc}, RPC ${target.realpricecode} (SCODE ${target.scode}): ${e2.message}`,
                    );
                }
            }
            throw new DonorTransferError(e.message, donor, orphaned);
        }

        // 3) Цепочка донор→приёмник (аудит).
        await this.invoiceService.logMigrationLink(
            {
                posting: target.posting,
                goodscode: gc,
                quantity: rest,
                donorScode: donor.scode,
                donorRpc: donor.realpricecode,
                targetScode: target.scode,
                targetRpc: target.realpricecode,
            },
            t,
        );
        return { moved: rest, codes: migrated, stuck };
    }
}
