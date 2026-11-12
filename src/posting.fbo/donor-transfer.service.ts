import { Inject, Injectable, Logger } from '@nestjs/common';
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

/** Кандидат пропущен: все изменения его кодов и подборки откатились до savepoint. */
export class DonorTransferError extends Error {
    constructor(
        message: string,
        readonly donor: DonorLineRef,
        readonly orphaned: string[] = [],
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

    constructor(@Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice) {}

    async transfer(
        donor: DonorLineRef,
        take: number,
        target: TransferTarget,
        t: FirebirdTransaction,
    ): Promise<TransferResult> {
        if (!t) throw new Error('Перенос донора требует общей транзакции');
        await t.execute('SAVEPOINT FBO_DONOR_TRANSFER', [], false);
        try {
            const result = await this.transferCandidate(donor, take, target, t);
            await t.execute('RELEASE SAVEPOINT FBO_DONOR_TRANSFER', [], false);
            return result;
        } catch (error) {
            // Включая уже перенесённые марки и изменения внутри хранимых процедур.
            // Если сам откат не прошёл, ошибка наружу: весь вызывающий сценарий обязан откатиться.
            await t.execute('ROLLBACK TO SAVEPOINT FBO_DONOR_TRANSFER', [], false);
            await t.execute('RELEASE SAVEPOINT FBO_DONOR_TRANSFER', [], false);
            throw error;
        }
    }

    private async transferCandidate(
        donor: DonorLineRef,
        take: number,
        target: TransferTarget,
        t: FirebirdTransaction,
    ): Promise<TransferResult> {
        const { goodscode: gc, nominal } = target;
        const s_s = this.invoiceService.getStorageSS();
        let rest = take;
        let stuck = 0;

        // 1) Коды: целые, только номинала строки, TT=3 вперёд (порядок задаёт выборка).
        const migrated: string[] = [];
        const codes = await this.invoiceService.findLiveMigratableCodes(donor.realpricecode, nominal, t);
        for (const code of codes.slice(0, Math.floor(take / nominal))) {
            try {
                await this.invoiceService.migrateMarkCode(
                    code.ki,
                    donor.realpricecode,
                    target.realpricecode,
                    gc,
                    s_s,
                    t,
                );
                migrated.push(code.ki);
            } catch (e) {
                // Код застрял (гонка, параллельная ручная операция, кривые данные): его штуки
                // остаются на доноре вместе с ним, иначе код повисает без товара и партийный учёт задваивается.
                rest -= nominal;
                stuck++;
                this.logger.warn(
                    `FBO migration: КМ ${code.ki} не переехал (RPC ${donor.realpricecode} -> ${target.realpricecode}): ${e.message}`,
                );
            }
        }
        if (rest <= 0) return { moved: 0, codes: migrated, stuck };

        // 2) Подборка: донор минус, приёмник плюс, атомарной SP.
        try {
            await this.invoiceService.migratePodbpos(
                donor.podbposcode,
                target.scode,
                target.realpricecode,
                gc,
                rest,
                t,
            );
        } catch (e) {
            this.logger.warn(
                `FBO migration: перенос подборки запрещён (PODBPOS ${donor.podbposcode}, take=${rest}): ${e.message}`,
            );
            throw new DonorTransferError(e.message, donor);
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
