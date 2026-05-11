import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebirdTransaction } from 'ts-firebird';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { InvoiceDto } from './dto/invoice.dto';
import { MarkScanProgressDto } from './dto/mark-scan-progress.dto';
import { MarkScanProgressLineDto } from './dto/mark-scan-progress-line.dto';
import { MarkScanResultDto } from './dto/mark-scan-result.dto';
import { extractKi } from '../helpers';

@Injectable()
export class MarkScanFbsService {
    private readonly logger = new Logger(MarkScanFbsService.name);

    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
    ) {}

    private isEnabled(): boolean {
        return this.configService.get<boolean>('OZON_FBO_MARK_MIGRATION', false);
    }

    async scan(invoice: InvoiceDto, rawScan: string): Promise<MarkScanResultDto> {
        if (!this.isEnabled()) throw new ConflictException('Сканирование КМ отключено');
        const ki = extractKi(rawScan);
        const transaction = await this.invoiceService.getTransaction();
        try {
            const goodscode = await this.invoiceService.findGoodscodeByKi(ki, transaction);
            if (!goodscode) {
                await transaction.rollback(true);
                throw new NotFoundException('КМ не найден в базе');
            }
            const rpc = await this.pickTargetRpc(invoice.id, goodscode, transaction);
            const ss = this.invoiceService.getStorageSS();
            await this.invoiceService.attachMarkCodeForFbs(ki, rpc, goodscode, ss, transaction);
            await transaction.commit(true);
            return {
                attached: { ki, goodscode, realpricecode: rpc },
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
            return { lines: [], isReadyToFinish: true, attachedKis: [] };
        }
        const transaction = await this.invoiceService.getTransaction();
        try {
            const lines = await this.invoiceService.getRealpriceLinesByScode(invoice.id, transaction);
            const attached = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, transaction);

            const uniqueGc = Array.from(new Set(lines.map((l) => l.goodscode)));
            const freeByGc = new Map<string, number>();
            for (const gc of uniqueGc) {
                freeByGc.set(gc, await this.invoiceService.countFreeMarkCodesForGood(gc, transaction));
            }

            const scannedByRpc = new Map<number, number>();
            for (const a of attached) {
                scannedByRpc.set(a.realpricecode, (scannedByRpc.get(a.realpricecode) ?? 0) + 1);
            }
            const scannedByGc = new Map<string, number>();
            for (const a of attached) {
                scannedByGc.set(a.goodscode, (scannedByGc.get(a.goodscode) ?? 0) + 1);
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
            };
        } finally {
            await transaction.commit(true).catch(() => undefined);
        }
    }

    async isReadyToFinish(invoice: InvoiceDto): Promise<boolean> {
        return (await this.getProgress(invoice)).isReadyToFinish;
    }

    private async pickTargetRpc(
        scode: number,
        goodscode: string,
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
            scannedByRpc.set(a.realpricecode, (scannedByRpc.get(a.realpricecode) ?? 0) + 1);
        }
        const target = matching.find((l) => (scannedByRpc.get(l.realpricecode) ?? 0) < l.quantity);
        if (!target) {
            throw new ConflictException('Лимит КМ для этого товара исчерпан');
        }
        return target.realpricecode;
    }
}
