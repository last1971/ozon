import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IProductCreateContext, getProductName } from '../interfaces/product-create.context';

@Injectable()
export class ExpandVariantsCommand implements ICommandAsync<IProductCreateContext> {
    async execute(context: IProductCreateContext): Promise<IProductCreateContext> {
        const { input } = context;
        const baseName = getProductName(context);
        const quantities = input.quantities?.length ? input.quantities : [1];
        const hasQuantities = !!input.quantities?.length;

        context.variants = quantities.map((qty) => ({
            qty,
            offerId: qty === 1 ? input.offer_id : `${input.offer_id}-${qty}`,
            name: hasQuantities ? `${baseName}, ${qty} шт` : baseName,
            depth: input.package_depth,
            width: input.package_width,
            height: input.package_height,
            weightWithPackaging: input.weight_with_packaging * qty,
            weightWithoutPackaging: input.weight_without_packaging * qty,
        }));

        context.logger?.log(`Варианты: ${context.variants.length} шт (${quantities.join(', ')})`);
        return context;
    }
}
