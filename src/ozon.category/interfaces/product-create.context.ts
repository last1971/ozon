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

    @ApiProperty({ description: 'Ссылка на картинку' })
    image_url: string;

    @ApiPropertyOptional({ type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, name: { type: 'string' }, src_url: { type: 'string' } } }, description: 'PDF файлы [{index, name, src_url}]' })
    pdf_list?: { index: number; name: string; src_url: string }[];

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

    // Шаг 6: Итоговый JSON
    product_json?: any;

    // Шаг 7: Отправка в Ozon
    task_id?: number;

    // Общее
    stopChain?: boolean;
    logger?: { log: (msg: string) => void };
}
