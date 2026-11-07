import { readOzonSaleLines } from '../helpers/price/ozon.accrual.normalizer';
import { RecordedWriteOff } from '../helpers/price/marketplace.loss.stats';
import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool, ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { IJobCommand } from '../interfaces/i.job.context';
import { jobCheckpoint } from '../job/job.checkpoint';
import { MpEventService, MpEventRowDto } from '../mp-event/mp-event.service';
import { ProductService } from '../product/product.service';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';
import { Trade2006AccrualService } from './trade2006.accrual.service';
import { OzonLossContext } from './ozon.loss.commands';
import { AccrualDto, AccrualTypeDto } from '../posting/dto/accrual.dto';
import {
    readOzonLossFees,
    calculateOzonLossExpenses,
    ozonReverseFees,
    ozonForwardFees,
    OzonLossFee,
    OzonLossExpenseEvidence,
} from '../helpers/price/ozon.loss.expenses';
import { ozonReturnEvidence, ozonPostingSkuKey } from '../helpers/price/ozon.return.evidence';

export interface OzonLossExpenseContext extends OzonLossContext {
    expenseAccruals?: AccrualDto[];
    expenseEvents?: MpEventRowDto[];
    expenseTypes?: AccrualTypeDto[];
    expenseWriteOffs?: RecordedWriteOff[];
    expenseFees?: OzonLossFee[];
    expenseEvidence?: OzonLossExpenseEvidence;
    expenseCancelled?: Set<string>;
    expenseIssues?: { offerId: string; reason: string }[];
}
@Injectable()
export class LoadOzonLossFinancialsCommand implements IJobCommand<OzonLossExpenseContext> {
    readonly phase = 'Расходы из журнала Ozon';
    readonly weight = 30;
    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        private readonly accruals: Trade2006AccrualService,
        private readonly events: MpEventService,
        private readonly products: ProductService,
    ) {}
    async execute(ctx: OzonLossExpenseContext) {
        await jobCheckpoint(ctx);
        const t = await this.pool.getTransaction(ISOLATION_READ_COMMITTED_READ_ONLY);
        try {
            ctx.expenseAccruals = await this.accruals.listLossAccruals(
                ctx.period.from,
                ctx.period.to,
                t,
                async (done, total) => {
                    ctx.progress.done = done;
                    ctx.progress.total = total;
                    await jobCheckpoint(ctx);
                },
            );
            ctx.expenseEvents = await this.events.findRows(
                'OZON',
                'RETURN',
                {
                    postings: [...new Set(ctx.expenseAccruals.map((row) => row.unit_number?.trim()).filter(Boolean))],
                },
                t,
            );
            ctx.expenseWriteOffs = [...ctx.writeOffs];
        } finally {
            await t.rollback(true);
        }
        ctx.expenseTypes = await this.products.getAccrualTypes();
        ctx.progress.done = ctx.progress.total = ctx.expenseAccruals.length;
        await jobCheckpoint(ctx);
        return ctx;
    }
}
@Injectable()
export class ReadOzonLossFeesCommand implements IJobCommand<OzonLossExpenseContext> {
    readonly phase = 'Разбор услуг Ozon';
    readonly weight = 20;
    async execute(ctx: OzonLossExpenseContext) {
        if (!ctx.expenseAccruals || !ctx.expenseTypes) throw new Error('Не загружены расходы Ozon');
        ctx.expenseFees = await readOzonLossFees(ctx.expenseAccruals, ctx.expenseTypes, ctx.period, ctx);
        return ctx;
    }
}
@Injectable()
export class ResolveOzonLossExpensesCommand implements IJobCommand<OzonLossExpenseContext> {
    readonly phase = 'Основания возвратной доставки Ozon';
    readonly weight = 10;
    constructor(private readonly invoices: Trade2006InvoiceService) {}
    async execute(ctx: OzonLossExpenseContext) {
        if (!ctx.expenseFees || !ctx.expenseEvents) throw new Error('Не разобраны услуги/события Ozon');
        const fees = ctx.expenseFees;
        const evidence = ozonReturnEvidence(ctx.expenseEvents, ctx.skuToOffer);
        const sales = new Set(
            readOzonSaleLines(ctx.expenseAccruals)
                .filter((line) => line.kind === 'sale')
                .map((line) => ozonPostingSkuKey(line.posting, line.sku)),
        );
        const ambiguous = [
            ...new Set(
                fees
                    .filter(
                        (fee) =>
                            fee.sku &&
                            (ozonReverseFees.has(fee.name) ||
                                (ozonForwardFees.has(fee.name) &&
                                    !sales.has(ozonPostingSkuKey(fee.posting, fee.sku)))) &&
                            !evidence.cancellations.has(ozonPostingSkuKey(fee.posting, fee.sku)) &&
                            !evidence.clients.has(ozonPostingSkuKey(fee.posting, fee.sku)),
                    )
                    .map((fee) => fee.posting),
            ),
        ];
        const cancelled = new Set<string>();
        const unknownPostings = new Set<string>();
        ctx.progress.total = ambiguous.length;
        ctx.progress.done = 0;
        for (let i = 0; i < ambiguous.length; i += 40) {
            await jobCheckpoint(ctx);
            const batch = ambiguous.slice(i, i + 40);
            const states = await this.invoices.getInvoiceStates(batch);
            for (const posting of batch) {
                const state = states.get(posting);
                if (state?.cancelled && !state.exact && !state.closed) cancelled.add(posting);
                else if (!state || (!state.exact && !state.closed) || state.cancelled) unknownPostings.add(posting);
            }
            ctx.progress.done += batch.length;
        }
        ctx.expenseEvidence = { ...evidence, unknownPostings };
        ctx.expenseCancelled = cancelled;
        return ctx;
    }
}
@Injectable()
export class CalculateOzonLossExpensesCommand implements IJobCommand<OzonLossExpenseContext> {
    readonly phase = 'Расчёт расходов Ozon';
    readonly weight = 10;
    async execute(ctx: OzonLossExpenseContext) {
        if (!ctx.expenseFees || !ctx.expenseEvidence || !ctx.expenseCancelled)
            throw new Error('Не подтверждены основания расходов Ozon');
        const result = await calculateOzonLossExpenses(
            ctx.expenseFees,
            ctx.rows,
            ctx.expenseWriteOffs ?? [],
            ctx.expenseEvidence,
            ctx.expenseCancelled,
            ctx,
        );
        ctx.expenses = result.expenses;
        ctx.expenseIssues = result.issues;
        if (result.issues.length) ctx.preliminary = true;
        ctx.progress.counters.expenseIssues = result.issues.length;
        ctx.expenseAccruals = [];
        ctx.expenseEvents = [];
        ctx.expenseFees = [];
        return ctx;
    }
}
@Injectable()
export class OzonLossFinancialCommands {
    readonly loading: IJobCommand<OzonLossExpenseContext>[];
    constructor(
        load: LoadOzonLossFinancialsCommand,
        read: ReadOzonLossFeesCommand,
        resolve: ResolveOzonLossExpensesCommand,
        readonly calculate: CalculateOzonLossExpensesCommand,
    ) {
        this.loading = [load, read, resolve];
    }
}
