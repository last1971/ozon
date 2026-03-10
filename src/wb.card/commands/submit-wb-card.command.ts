import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';
import { WbApiService } from '../../wb.api/wb.api.service';

@Injectable()
export class SubmitWbCardCommand implements ICommandAsync<IWbCreateCardContext> {
    constructor(private readonly wbApiService: WbApiService) {}

    async execute(context: IWbCreateCardContext): Promise<IWbCreateCardContext> {
        const result = await this.wbApiService.method(
            'https://content-api.wildberries.ru/content/v2/cards/upload',
            'post',
            context.uploadBody,
            true,
        );

        context.uploadResult = result;

        if (result?.error) {
            context.stopChain = true;
            context.error_message = `WB API ошибка: ${result.error.message || JSON.stringify(result.error)}`;
        }

        return context;
    }
}
