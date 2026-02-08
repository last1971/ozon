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
  ]
}

Правила для атрибутов:
- Если у атрибута есть список значений — ВЫБЕРИ из списка и верни dictionary_value_id
- Если списка нет — сгенерируй подходящее текстовое значение
- Числовые значения — только число, без единиц измерения
- Если не знаешь значение — НЕ включай атрибут в массив`;

export function buildProductAttributesPrompt(
    generatedName: string,
    originalText: string,
    attributes: CategoryAttribute[],
): string {
    let prompt = `Товар: "${generatedName}"\n`;
    prompt += `Исходные данные: "${originalText}"\n\n`;
    prompt += `Заполни следующие обязательные атрибуты:\n\n`;

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
