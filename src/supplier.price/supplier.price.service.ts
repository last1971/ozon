import { Injectable, Logger } from '@nestjs/common';
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { ISupplierPriceContext } from './interfaces/supplier.price.context';
import { SupplierPriceRequestDto } from './dto/supplier.price.request.dto';
import { SupplierPriceResponseDto } from './dto/supplier.price.response.dto';
import { ValidateBatchCommand } from './commands/validate-batch.command';
import { ConvertCurrencyCommand } from './commands/convert-currency.command';
import { AddDeliveryCommand } from './commands/add-delivery.command';
import { ApplyMarkupCommand } from './commands/apply-markup.command';
import { BuildResponseCommand } from './commands/build-response.command';

/**
 * Калькулятор цен поставщиков: пачка входящих (поставщик, цена в валюте, ступени, курсы) → пачка исходящих
 * (рубли для сайта). Про прайсинг не знает, на сайте ничего не заводит. Цепочка: проверка → валюта →
 * доставка → наценка → ответ; у каждого поставщика свои кирпичи (SupplierPriceStrategyRegistry).
 */
@Injectable()
export class SupplierPriceService {
    private readonly logger = new Logger(SupplierPriceService.name);
    private readonly chain: CommandChainAsync<ISupplierPriceContext>;

    constructor(
        validate: ValidateBatchCommand,
        convertCurrency: ConvertCurrencyCommand,
        addDelivery: AddDeliveryCommand,
        applyMarkup: ApplyMarkupCommand,
        buildResponse: BuildResponseCommand,
    ) {
        this.chain = new CommandChainAsync<ISupplierPriceContext>([
            validate,
            convertCurrency,
            addDelivery,
            applyMarkup,
            buildResponse,
        ]);
    }

    async calculate(request: SupplierPriceRequestDto): Promise<SupplierPriceResponseDto> {
        const context = await this.chain.execute({
            rates: request.rates ?? {},
            items: request.items.map((input) => ({ input })),
            prices: [],
            errors: [],
            logger: this.logger,
        });
        if (context.stopChain) {
            // Цепочка остановилась на проверке — ответ всё равно собираем, чтобы сайт увидел причины
            context.errors = context.items.map((i) => ({
                supplier: i.input.supplier,
                code: i.input.code,
                error: i.error,
            }));
        }
        return { prices: context.prices, errors: context.errors };
    }
}
