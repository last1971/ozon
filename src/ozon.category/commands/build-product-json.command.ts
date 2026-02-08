import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { numberToVat } from '../../helpers';

function formatHashtags(raw: string): string {
    if (!raw) return '';
    return raw
        .split(/[,;]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => {
            const tag = t.startsWith('#') ? t.slice(1) : t;
            return '#' + tag.replace(/[\s-]+/g, '_').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_]/g, '');
        })
        .join(' ');
}

@Injectable()
export class BuildProductJsonCommand implements ICommandAsync<IProductCreateContext> {
    constructor(private readonly configService: ConfigService) {}

    async execute(context: IProductCreateContext): Promise<IProductCreateContext> {
        context.logger?.log('Сборка JSON для создания товара');

        const { input } = context;
        const vatRate = this.configService.get<number>('VAT_RATE');
        const vat = vatRate !== undefined ? numberToVat(vatRate) : '0.05';
        const hashtags = formatHashtags(context.hashtags || '');

        const items = (context.variants || []).map((variant) => {
            const attributes = [
                ...(context.resolved_attributes || []),
                { id: 4191, complex_id: 0, values: [{ value: context.description || '' }] },
                { id: 4383, complex_id: 0, values: [{ value: variant.weightWithoutPackaging.toString() }] },
                { id: 8513, complex_id: 0, values: [{ value: variant.qty.toString() }] },
                { id: 23171, complex_id: 0, values: [{ value: hashtags }] },
                { id: 23249, complex_id: 0, values: [{ value: variant.qty.toString() }] },
                { id: 23518, complex_id: 0, values: [{ value: '1' }] },
            ];

            return {
                attributes,
                description_category_id: context.description_category_id,
                new_description_category_id: 0,
                currency_code: 'RUB',
                depth: variant.depth,
                dimension_unit: 'mm',
                height: variant.height,
                width: variant.width,
                images: input.images,
                ...(input.pdf_list?.length ? { pdf_list: input.pdf_list } : {}),
                name: variant.name,
                offer_id: variant.offerId,
                price: '100000',
                type_id: context.type_id,
                vat,
                weight: variant.weightWithPackaging,
                weight_unit: 'g',
            };
        });

        context.product_json = { items };

        context.logger?.log(`JSON собран: ${items.length} товар(ов), ${items[0]?.attributes.length || 0} атрибутов, vat=${vat}`);
        return context;
    }
}
