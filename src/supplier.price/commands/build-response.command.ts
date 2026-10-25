import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ISupplierPriceContext } from '../interfaces/supplier.price.context';

/** Собирает ответ: посчитанные — в prices, строки с ошибкой — в errors (сайт решает, что с ними делать). */
@Injectable()
export class BuildResponseCommand implements ICommandAsync<ISupplierPriceContext> {
    async execute(context: ISupplierPriceContext): Promise<ISupplierPriceContext> {
        context.prices = context.items.filter((i) => i.result).map((i) => i.result);
        context.errors = context.items
            .filter((i) => i.error)
            .map((i) => ({ supplier: i.input.supplier, code: i.input.code, error: i.error }));
        context.logger?.log(`Цены поставщиков: посчитано ${context.prices.length}, ошибок ${context.errors.length}`);
        return context;
    }
}
