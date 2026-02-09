import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AIProviderName } from '../../ai/interfaces';
import { CategoryAttribute } from '../ozon.category.service';

export class CreateProductInput {
    @ApiProperty({ description: 'Исходный текст товара' })
    text: string;

    @ApiProperty({ description: 'Артикул' })
    offer_id: string;

    @ApiProperty({ description: 'Глубина упаковки, мм' })
    package_depth: number;

    @ApiProperty({ description: 'Ширина упаковки, мм' })
    package_width: number;

    @ApiProperty({ description: 'Высота упаковки, мм' })
    package_height: number;

    @ApiProperty({ description: 'Вес с упаковкой, г' })
    weight_with_packaging: number;

    @ApiProperty({ description: 'Вес без упаковки, г' })
    weight_without_packaging: number;

    @ApiProperty({ type: [String], description: 'Ссылки на картинки' })
    images: string[];

    @ApiPropertyOptional({ type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, name: { type: 'string' }, src_url: { type: 'string' } } }, description: 'PDF файлы [{index, name, src_url}]' })
    pdf_list?: { index: number; name: string; src_url: string }[];

    @ApiPropertyOptional({ type: 'array', items: { type: 'integer' }, description: 'Варианты количества, напр. [1, 10, 50, 100]' })
    quantities?: number[];

    @ApiPropertyOptional({ type: 'array', items: { oneOf: [{ type: 'integer' }, { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 }] }, description: 'Упаковки для каждого варианта: 1 = те же размеры, [d,w,h] = кастомные мм' })
    packages?: (number | [number, number, number])[];

    @ApiPropertyOptional({ description: 'Путь категории, напр. "Электроника > Электронные компоненты > Конденсаторы"' })
    category_path?: string;

    @ApiPropertyOptional({ description: 'Генерировать все атрибуты (1 = да), по умолчанию только обязательные' })
    all_attributes?: number;

    @ApiPropertyOptional({ enum: AIProviderName, description: 'AI провайдер (default: ANTHROPIC)' })
    provider?: AIProviderName;

    @ApiPropertyOptional({ description: 'Модель AI' })
    model?: string;
}

export interface IProductCreateContext {
    input: CreateProductInput;

    // Шаг 1: Название
    generated_name?: string;
    name_cost?: { tokens: number; cost: number };

    // Шаг 2: Категория
    description_category_id?: number;
    type_id?: number;
    fbs_commission?: number;
    category_path?: string;

    // Шаг 3: Обязательные атрибуты
    required_attributes?: CategoryAttribute[];

    // Шаг 4: AI-генерация
    description?: string;
    hashtags?: string;
    ai_attributes?: { id: number; value: string; dictionary_value_id?: number }[];
    ai_cost?: { tokens: number; cost: number };

    // Шаг 5: Резолв словарей
    resolved_attributes?: { id: number; complex_id: number; values: { dictionary_value_id?: number; value: string }[] }[];

    // Шаг 6: Варианты (кол-во, упаковка)
    variants?: ProductVariant[];

    // Шаг 7: Итоговый JSON
    product_json?: any;

    // Шаг 8: Отправка в Ozon
    task_id?: number;

    // Общее
    stopChain?: boolean;
    error_message?: string;
    logger?: { log: (msg: string) => void };
}

export interface ProductVariant {
    qty: number;
    offerId: string;
    name: string;
    depth: number;
    width: number;
    height: number;
    weightWithPackaging: number;
    weightWithoutPackaging: number;
    packagingName?: string;
}

/** Атрибуты, заполняемые программно (не через AI) */
export const MANUAL_ATTRIBUTE_IDS = new Set([4191, 4383, 8513, 23171, 23249, 23518]);

/** Название товара: generated_name или fallback на input.text */
export function getProductName(context: IProductCreateContext): string {
    return context.generated_name || context.input.text;
}
