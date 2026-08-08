import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { GOOD_SERVICE, IGood } from '../../../interfaces/IGood';
import { IGoodsCountContext } from './i.goods.count.context';

/**
 * Читает всё нужное для пересчёта ОДНИМ снимком: товары (крон-путь), отключения,
 * маркируемость и свободные коды по номиналам.
 *
 * Транзакция закрывается сразу после чтения — дальше идут расчёт и поход в маркет,
 * держать её на время HTTP-запросов нельзя. Без общего снимка остаток и коды могут
 * разъехаться: кладовщик привязывает код между двумя запросами, и `need` завышается.
 */
@Injectable()
export class LoadSnapshotCommand implements ICommandAsync<IGoodsCountContext> {
    constructor(@Inject(GOOD_SERVICE) private readonly goodService: IGood) {}

    async execute(context: IGoodsCountContext): Promise<IGoodsCountContext> {
        const transaction = await this.goodService.getTransaction();
        try {
            const goods = context.goodIds?.length
                ? await this.goodService.in(context.goodIds, transaction)
                : context.goods;

            const goodCodes = goods.map((good) => String(good.code));
            const disabled = new Set(await this.goodService.getDisabledCodes(context.serviceKey, transaction));

            // Считается по маркировке тот, кто и подлежит маркировке, и уже имеет коды
            // (договорённость 8: маркируемый без кодов идёт по старой схеме).
            const markRequired = await this.goodService.getMarkRequiredCodes(transaction);
            const withCodes = markRequired.size
                ? await this.goodService.getGoodsWithMarkCodes(
                      goodCodes.filter((code) => markRequired.has(code)),
                      transaction,
                  )
                : new Set<string>();

            const freeByGood = withCodes.size
                ? await this.goodService.getFreeMarkCodesByNominal(Array.from(withCodes), transaction)
                : new Map<string, Map<number, number>>();

            await transaction?.commit(true);

            return { ...context, goods, disabled, markedGoods: withCodes, freeByGood, transaction: null };
        } catch (e) {
            try {
                await transaction?.rollback(true);
            } catch {
                // откат не удался — наружу отдаём исходную ошибку чтения
            }
            throw e;
        }
    }
}
