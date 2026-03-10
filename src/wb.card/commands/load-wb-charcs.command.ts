import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';
import { WbCardService } from '../wb.card.service';

@Injectable()
export class LoadWbCharcsCommand implements ICommandAsync<IWbCreateCardContext> {
    constructor(@Inject(forwardRef(() => WbCardService)) private readonly wbCardService: WbCardService) {}

    async execute(context: IWbCreateCardContext): Promise<IWbCreateCardContext> {
        context.charcs = await this.wbCardService.getCharacteristics(context.subjectId);
        return context;
    }
}
