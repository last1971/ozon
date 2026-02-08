import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { ProductService } from '../../product/product.service';

function findInDictionary(aiValue: string, values: { id: number; value: string }[]): { id: number; value: string } | undefined {
    const lower = aiValue.toLowerCase();
    // Точное совпадение
    const exact = values.find((v) => v.value.toLowerCase() === lower);
    if (exact) return exact;
    // Словарное значение содержит AI-текст: "Китай (Тайвань)" includes "тайвань"
    const includes = values.find((v) => v.value.toLowerCase().includes(lower));
    if (includes) return includes;
    // AI-текст содержит словарное значение: "Защита от перегрева" includes "перегрев"
    const reverseIncludes = values.find((v) => lower.includes(v.value.toLowerCase()));
    if (reverseIncludes) return reverseIncludes;
    return undefined;
}

@Injectable()
export class ResolveDictionaryValuesCommand implements ICommandAsync<IProductCreateContext> {
    constructor(private readonly productService: ProductService) {}

    async execute(context: IProductCreateContext): Promise<IProductCreateContext> {
        const aiAttributes = context.ai_attributes || [];
        const requiredAttributes = context.required_attributes || [];
        const descCatId = context.description_category_id!;
        const typeId = context.type_id!;

        context.logger?.log(`Резолв словарных значений для ${aiAttributes.length} атрибутов`);

        const resolved: IProductCreateContext['resolved_attributes'] = [];

        for (const aiAttr of aiAttributes) {
            const attrMeta = requiredAttributes.find((a) => a.id === aiAttr.id);

            // Если AI уже вернул dictionary_value_id — используем как есть
            if (aiAttr.dictionary_value_id) {
                resolved.push({
                    id: aiAttr.id,
                    complex_id: 0,
                    values: [{ dictionary_value_id: aiAttr.dictionary_value_id, value: aiAttr.value }],
                });
                continue;
            }

            // Если это атрибут с большим словарём (values_count > 0) — ищем в кэше
            if (attrMeta?.values_count && attrMeta.values_count > 0) {
                context.logger?.log(`  Поиск "${aiAttr.value}" в словаре атрибута ${aiAttr.id} (${attrMeta.values_count} значений)`);

                const allValues = await this.productService.getCategoryAttributeValues(
                    aiAttr.id,
                    descCatId,
                    typeId,
                );

                const match = findInDictionary(aiAttr.value, allValues);

                if (match) {
                    context.logger?.log(`  Найдено: id=${match.id}, value="${match.value}"`);
                    resolved.push({
                        id: aiAttr.id,
                        complex_id: 0,
                        values: [{ dictionary_value_id: match.id, value: match.value }],
                    });
                } else {
                    context.logger?.log(`  Не найдено совпадение для "${aiAttr.value}" — отправляем текстом`);
                    resolved.push({
                        id: aiAttr.id,
                        complex_id: 0,
                        values: [{ value: aiAttr.value }],
                    });
                }
                continue;
            }

            // Атрибут без словаря или с маленьким словарём без dictionary_value_id
            if (attrMeta?.dictionary_id && attrMeta.dictionary_id > 0 && attrMeta.values?.length > 0) {
                // Маленький словарь — ищем в уже загруженных values
                const match = findInDictionary(aiAttr.value, attrMeta.values);
                if (match) {
                    resolved.push({
                        id: aiAttr.id,
                        complex_id: 0,
                        values: [{ dictionary_value_id: match.id, value: match.value }],
                    });
                } else {
                    context.logger?.log(`  Не найдено совпадение для "${aiAttr.value}" в словаре ${aiAttr.id} — отправляем текстом`);
                    resolved.push({
                        id: aiAttr.id,
                        complex_id: 0,
                        values: [{ value: aiAttr.value }],
                    });
                }
                continue;
            }

            // Свободный текст (атрибут без словаря)
            resolved.push({
                id: aiAttr.id,
                complex_id: 0,
                values: [{ value: aiAttr.value }],
            });
        }

        context.resolved_attributes = resolved;
        context.logger?.log(`Резолв завершён: ${resolved.length} атрибутов`);
        return context;
    }
}
