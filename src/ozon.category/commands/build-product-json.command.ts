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

        const attributes = [
            ...(context.resolved_attributes || []),
            // Описание
            { id: 4191, complex_id: 0, values: [{ value: context.description || '' }] },
            // Вес без упаковки
            { id: 4383, complex_id: 0, values: [{ value: input.weight_without_packaging.toString() }] },
            // Хэштеги
            { id: 23171, complex_id: 0, values: [{ value: formatHashtags(context.hashtags || '') }] },
            // Фиксированные
            { id: 23249, complex_id: 0, values: [{ value: '1' }] },
            { id: 23518, complex_id: 0, values: [{ value: '1' }] },
        ];

        context.product_json = {
            items: [
                {
                    attributes,
                    description_category_id: context.description_category_id,
                    new_description_category_id: 0,
                    currency_code: 'RUB',
                    depth: input.package_depth,
                    dimension_unit: 'mm',
                    height: input.package_height,
                    width: input.package_width,
                    images: [input.image_url],
                    ...(input.pdf_list?.length ? { pdf_list: input.pdf_list } : {}),
                    name: context.generated_name || input.text,
                    offer_id: input.offer_id,
                    price: '100000',
                    type_id: context.type_id,
                    vat,
                    weight: input.weight_with_packaging,
                    weight_unit: 'g',
                },
            ],
        };

        context.logger?.log(`JSON собран: ${attributes.length} атрибутов, vat=${vat}`);
        return context;
    }
}
