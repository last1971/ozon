import { CategoryAttribute } from '../ozon.category.service';

export const PRODUCT_ATTRIBUTES_SYSTEM_PROMPT = `Ты специалист по заполнению карточек товаров для маркетплейса Ozon.

ПЕРЕД заполнением атрибутов ОБЯЗАТЕЛЬНО выполни веб-поиск по названию товара. Используй найденные данные для заполнения. Не полагайся на свои знания — ищи всегда.

Задача: на основе названия товара, исходных данных и результатов веб-поиска сгенерировать описание, хэштеги и заполнить обязательные атрибуты.

Отвечай СТРОГО в формате JSON без пояснений:
{
  "description": "Описание товара для Ozon (информативное, без воды)",
  "hashtags": "ключевое1, ключевое2, ключевое3 (через запятую, без #, 5-10 штук, БЕЗ названий брендов, только буквы цифры и пробелы)",
  "attributes": [
    { "id": <attribute_id>, "value": "<значение>", "dictionary_value_id": <id_если_выбрано_из_списка> }
  ],
  "dimensions": { "depth": <мм>, "width": <мм>, "height": <мм>, "weight": <г_без_упаковки>, "weight_with_packaging": <г_с_упаковкой> }
}

Правила для атрибутов:
- Если у атрибута есть список значений — ВЫБЕРИ из списка и верни dictionary_value_id
- Если списка нет — сгенерируй подходящее текстовое значение
- Числовые значения — только число, без единиц измерения
- Если атрибут НЕ относится к данному товару или ты не знаешь точное значение — НЕ включай его в массив

Правила для dimensions:
- Поле dimensions ОБЯЗАТЕЛЬНО всегда
- На основе веб-поиска определи реальные габариты товара (одной штуки без упаковки) в мм и вес в граммах
- depth, width, height — размеры упаковки одной штуки товара в мм
- weight — вес одной штуки БЕЗ упаковки в граммах
- weight_with_packaging — вес одной штуки С упаковкой в граммах (обычно на 10-50г больше weight)
- Размеры упаковки обычно чуть больше самого товара (добавь 5-10мм к каждому измерению)
- Если точные данные не найдены — оцени по аналогичным товарам`;

export interface DimensionsInput {
    depth: number;
    width: number;
    height: number;
    weight: number;
    weightWithPackaging: number;
}

export function buildProductAttributesPrompt(
    generatedName: string,
    originalText: string,
    attributes: CategoryAttribute[],
    dimensions?: DimensionsInput,
): string {
    let prompt = `Товар: "${generatedName}"\n`;
    prompt += `Исходные данные: "${originalText}"\n\n`;

    if (dimensions) {
        const parts: string[] = [];
        if (dimensions.depth) parts.push(`глубина: ${dimensions.depth}мм`);
        if (dimensions.width) parts.push(`ширина: ${dimensions.width}мм`);
        if (dimensions.height) parts.push(`высота: ${dimensions.height}мм`);
        if (dimensions.weight) parts.push(`вес без упаковки: ${dimensions.weight}г`);
        if (dimensions.weightWithPackaging) parts.push(`вес с упаковкой: ${dimensions.weightWithPackaging}г`);
        if (parts.length > 0) {
            prompt += `Известные габариты: ${parts.join(', ')}\n`;
        }
        const missing: string[] = [];
        if (!dimensions.depth) missing.push('глубина');
        if (!dimensions.width) missing.push('ширина');
        if (!dimensions.height) missing.push('высота');
        if (!dimensions.weight) missing.push('вес без упаковки');
        if (!dimensions.weightWithPackaging) missing.push('вес с упаковкой');
        if (missing.length > 0) {
            prompt += `НЕ ЗАДАНЫ: ${missing.join(', ')} — ОПРЕДЕЛИ через веб-поиск!\n`;
        }
        prompt += '\n';
    }

    prompt += `Заполни следующие атрибуты (пропусти те, что не относятся к товару):\n\n`;

    for (const attr of attributes) {
        prompt += `--- Атрибут ID: ${attr.id} ---\n`;
        prompt += `Название: ${attr.name}\n`;
        if (attr.description) prompt += `Описание: ${attr.description}\n`;
        prompt += `Тип: ${attr.type}\n`;

        if (attr.values && attr.values.length > 0) {
            prompt += `Значения (ВЫБЕРИ из списка, верни dictionary_value_id):\n`;
            for (const v of attr.values) {
                prompt += `  - id: ${v.id}, value: "${v.value}"\n`;
            }
        } else if (attr.values_count && attr.values_count > 0) {
            prompt += `Словарь: ${attr.values_count} значений (список не передан, сгенерируй текст)\n`;
        } else {
            prompt += `Свободный ввод\n`;
        }
        prompt += `\n`;
    }

    return prompt;
}
