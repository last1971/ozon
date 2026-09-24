import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { IMissingTnvedContext } from '../../interfaces/i.missing.tnved.context';

/** Все карточки маркетплейса → ctx.offers. Маркетплейс сам знает, откуда их брать. */
@Injectable()
export class LoadMarketOffersCommand implements IJobCommand<IMissingTnvedContext> {
    readonly phase = 'каталог';

    async execute(context: IMissingTnvedContext): Promise<IMissingTnvedContext> {
        context.offers = await context.service.listOffers(context.progress);
        return context;
    }
}
