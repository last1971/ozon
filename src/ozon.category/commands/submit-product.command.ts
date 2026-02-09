import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { OzonApiService } from '../../ozon.api/ozon.api.service';

@Injectable()
export class SubmitProductCommand implements ICommandAsync<IProductCreateContext> {
    constructor(private readonly ozonApiService: OzonApiService) {}

    async execute(context: IProductCreateContext): Promise<IProductCreateContext> {
        if (!context.product_json) {
            context.logger?.log('Нет product_json, пропускаем отправку');
            context.stopChain = true;
            return context;
        }

        context.logger?.log('Отправка товара в Ozon API /v3/product/import');

        const response = await this.ozonApiService.method('/v3/product/import', context.product_json);

        context.task_id = response?.result?.task_id;
        context.logger?.log(`Ozon task_id: ${context.task_id}`);

        return context;
    }
}
