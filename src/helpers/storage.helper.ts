import { ConfigService } from '@nestjs/config';

/**
 * Сторона подбора инсталляции: 1 — магазин (QUANSHOP, SPISSHOP), 0 — склад (QUANSKLAD, SPISSKLAD).
 * Одна база = один режим; решает `STORAGE_TYPE` (по умолчанию SHOPSKLAD — магазин).
 */
export function storageSS(configService: ConfigService): 0 | 1 {
    return configService.get<string>('STORAGE_TYPE', 'SHOPSKLAD').toUpperCase() === 'SHOPSKLAD' ? 1 : 0;
}
