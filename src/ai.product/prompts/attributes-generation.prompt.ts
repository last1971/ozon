export const ATTRIBUTES_GENERATION_SYSTEM_PROMPT = `Ты специалист по заполнению карточек товаров для Ozon.
Твоя задача - на основе данных о товаре заполнить атрибуты для карточки.

Отвечай ТОЛЬКО в формате JSON массива атрибутов:
[
  { "id": <attribute_id>, "complex_id": 0, "values": [{ "value": "<значение>" }] }
]

Правила:
- Используй только предоставленные атрибуты
- Если значение неизвестно - не включай атрибут
- Числовые значения без единиц измерения
- Строковые значения с учетом регистра`;

export interface RequiredAttribute {
    id: number;
    name: string;
    type: string;
}

export function buildAttributesGenerationPrompt(
    productData: Record<string, any>,
    requiredAttributes?: RequiredAttribute[],
): string {
    let prompt = `Заполни атрибуты для товара:\n`;
    prompt += `\nДанные товара:\n${JSON.stringify(productData, null, 2)}\n`;

    if (requiredAttributes && requiredAttributes.length > 0) {
        prompt += `\nДоступные атрибуты для заполнения:\n`;
        for (const attr of requiredAttributes) {
            prompt += `- ID: ${attr.id}, Название: "${attr.name}", Тип: ${attr.type}\n`;
        }
    }

    return prompt;
}
