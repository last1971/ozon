import { WbCharc, WB_MANUAL_CHARC_NAMES } from '../interfaces/wb-create-card.interface';

export const WB_CHARACTERISTICS_SYSTEM_PROMPT = `Ты специалист по заполнению карточек товаров для маркетплейса Wildberries.

Задача: на основе названия товара и описания заполнить характеристики товара для указанной категории WB.

Отвечай СТРОГО в формате JSON без пояснений:
{
  "characteristics": [
    { "id": <charcID>, "value": <значение> }
  ]
}

Правила:
- charcType: 1, maxCount: 1 → value: "строка"
- charcType: 1, maxCount > 1 → value: ["стр1", "стр2"] (не более maxCount элементов)
- charcType: 1, maxCount: 0 → value: "строка"
- charcType: 4 → value: число (БЕЗ единиц измерения, единица уже указана в unitName)
- Если значение неизвестно или характеристика не относится к товару — НЕ включай в массив
- Числовые значения — только число, без текста`;

export function buildWbCharcsPrompt(
    productName: string,
    description: string,
    charcs: WbCharc[],
): string {
    const filtered = charcs.filter(
        (c) => c.charcType !== 0 && !WB_MANUAL_CHARC_NAMES.has(c.name),
    );

    let prompt = `Товар: "${productName}"\n`;
    if (description) {
        const clean = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        prompt += `Описание: "${clean.slice(0, 2000)}"\n`;
    }
    prompt += `\nЗаполни следующие характеристики WB:\n\n`;

    for (const c of filtered) {
        prompt += `--- charcID: ${c.charcID} ---\n`;
        prompt += `Название: ${c.name}\n`;
        prompt += `Тип: ${c.charcType === 1 ? 'строка' : 'число'}`;
        if (c.unitName) prompt += ` (${c.unitName})`;
        prompt += `\n`;
        if (c.charcType === 1 && c.maxCount > 1) {
            prompt += `Макс. значений: ${c.maxCount}\n`;
        }
        prompt += `\n`;
    }

    return prompt;
}
