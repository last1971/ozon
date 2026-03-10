import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';
import { WbCardService } from '../wb.card.service';

@Injectable()
export class CheckWbCardExistsCommand implements ICommandAsync<IWbCreateCardContext> {
    constructor(@Inject(forwardRef(() => WbCardService)) private readonly wbCardService: WbCardService) {}

    async execute(context: IWbCreateCardContext): Promise<IWbCreateCardContext> {
        const existing = await this.wbCardService.getWbCardAsync(context.offerId);
        if (existing) {
            context.stopChain = true;
            context.error_message = `Карточка уже существует в WB: vendorCode=${context.offerId}, nmID=${existing.nmID}`;
        }
        return context;
    }
}
