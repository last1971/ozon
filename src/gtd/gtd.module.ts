import { Module } from '@nestjs/common';
import { OzonGtdFormat } from './ozon.gtd.format';
import { PartyReceiptGtdCommand } from './commands/party-receipt.gtd.command';
import { LastGoodReceiptGtdCommand } from './commands/last-good-receipt.gtd.command';
import { GtdResolver } from './gtd.resolver';

/**
 * Поиск ГТД приходной партии. Наружу торчит только GtdResolver — источники и правило
 * формата остаются внутри, чтобы приоритет нельзя было обойти мимо распорядителя.
 *
 * Команды работают в ЧУЖОЙ транзакции (она приходит в контексте), поэтому FirebirdModule
 * здесь не нужен.
 */
@Module({
    providers: [OzonGtdFormat, PartyReceiptGtdCommand, LastGoodReceiptGtdCommand, GtdResolver],
    exports: [GtdResolver],
})
export class GtdModule {}
