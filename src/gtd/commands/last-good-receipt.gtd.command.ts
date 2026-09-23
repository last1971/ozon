import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGtdContext } from '../gtd.context';
import { receiptGtdExpr } from '../receipt.gtd.sql';

/**
 * Источник 2 (фолбэк): приходы ТОГО ЖЕ товара, не позже даты партии, свежие первыми.
 *
 * Зачем. Партию можно оприходовать мимо накладной — пересортица, излишки, инвентаризация
 * пишутся прямо в PR_META, SKLADINCODE и SHOPINCODE там пусты, и источник 1 пуст ВСЕГДА.
 * Озон на такое отвечает GTD_MUST_BE_SPECIFIED_FOR_PRODUCT_COUNTRY и отбивает отгрузку целиком:
 * 19.08.2026 — отправление 0172200080-0019-1, партия PR_META 2921988 (SPISSKLAD 9516, «пересортица»);
 * 23.09.2026 — товар 565565 (MDR-60-24), партии PR_META 2928063 и 2932628, 12 кодов.
 * Оба раза расшивали руками, подставляя ГТД соседнего прихода того же товара.
 *
 * Почему «не позже даты партии». Пересортицу находят среди того, что УЖЕ лежит на складе:
 * ввезли это раньше, чем пересчитали. Приход, случившийся после партии, — чужая поставка.
 *
 * Почему СПИСОК, а не один номер. У старых приходов номер бывает с литерой и Озону не годится
 * (см. OzonGtdFormat). Один-единственный кандидат снова упёрся бы в пустоту, поэтому отдаём
 * несколько подряд — годный из них выберет GtdResolver.
 */
@Injectable()
export class LastGoodReceiptGtdCommand implements ICommandAsync<IGtdContext> {
    /** Насколько вглубь смотрим приходы: запас на кривые номера, которые будут пропущены. */
    private static readonly DEPTH = 20;

    async execute(ctx: IGtdContext): Promise<IGtdContext> {
        const byDate = ctx.partyDate ? 'AND pm.DATA <= ? ' : '';
        const params: (string | number | Date)[] = [ctx.goodscode, ctx.partyId];
        if (ctx.partyDate) params.push(ctx.partyDate);
        const rows = await ctx.transaction.query(
            `SELECT FIRST ${LastGoodReceiptGtdCommand.DEPTH} ${receiptGtdExpr('pm')} AS GTD FROM PR_META pm ` +
                `WHERE pm.GOODSCODE = ? AND pm.P_R = 0 AND pm.ID <> ? ${byDate}` +
                'ORDER BY pm.DATA DESC, pm.ID DESC',
            params,
            false,
        );
        ctx.candidates = (rows ?? []).map((r) => r.GTD).filter((gtd) => gtd != null).map(String);
        return ctx;
    }
}
