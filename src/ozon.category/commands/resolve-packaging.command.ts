import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { findPackagingForBatch } from '../packaging';

@Injectable()
export class ResolvePackagingCommand implements ICommandAsync<IProductCreateContext> {
    async execute(context: IProductCreateContext): Promise<IProductCreateContext> {
        const { input } = context;
        const packages = input.packages || [];

        for (let i = 0; i < (context.variants || []).length; i++) {
            const variant = context.variants![i];
            const pkg = packages[i];

            if (Array.isArray(pkg)) {
                // Ручные размеры упаковки [d, w, h]
                variant.depth = pkg[0];
                variant.width = pkg[1];
                variant.height = pkg[2];
                variant.weightWithPackaging = input.weight_with_packaging * variant.qty;
            } else {
                // Автоподбор упаковки по размерам товара
                if (!input.package_depth || !input.package_width || !input.package_height) {
                    context.logger?.log(`Пропуск автоподбора упаковки для ${variant.qty} шт: размеры товара не заданы`);
                    continue;
                }
                const result = findPackagingForBatch(
                    {
                        depth: input.package_depth,
                        width: input.package_width,
                        height: input.package_height,
                        weight: input.weight_without_packaging || 0,
                    },
                    variant.qty,
                );
                if (result) {
                    variant.depth = result.packageDepth;
                    variant.width = result.packageWidth;
                    variant.height = result.packageHeight;
                    variant.weightWithPackaging = result.weightWithPackaging;
                    variant.packagingName = result.packaging.name;
                    context.logger?.log(`Упаковка для ${variant.qty} шт: ${result.packaging.name} (${variant.depth}×${variant.width}×${variant.height}мм, ${variant.weightWithPackaging}г)`);
                } else {
                    context.logger?.log(`Упаковка для ${variant.qty} шт: не найдена, используем исходные размеры`);
                }
            }
        }

        return context;
    }
}
