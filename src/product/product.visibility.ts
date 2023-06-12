import { ApiProperty } from '@nestjs/swagger';

export enum ProductVisibility {
    ALL = 'ALL',
    VISIBLE = 'VISIBLE',
    INVISIBLE = 'INVISIBLE',
    EMPTY_STOCK = 'EMPTY_STOCK',
    NOT_MODERATED = 'NOT_MODERATED',
    MODERATED = 'MODERATED',
    DISABLED = 'DISABLED',
    STATE_FAILED = 'STATE_FAILED',
    READY_TO_SUPPLY = 'READY_TO_SUPPLY',
    VALIDATION_STATE_PENDING = 'VALIDATION_STATE_PENDING',
    VALIDATION_STATE_FAIL = 'VALIDATION_STATE_FAIL',
    VALIDATION_STATE_SUCCESS = 'VALIDATION_STATE_SUCCESS',
    TO_SUPPLY = 'TO_SUPPLY',
    IN_SALE = 'IN_SALE',
    REMOVED_FROM_SALE = 'REMOVED_FROM_SALE',
    BANNED = 'BANNED',
    OVERPRICED = 'OVERPRICED',
    CRITICALLY_OVERPRICED = 'CRITICALLY_OVERPRICED',
    EMPTY_BARCODE = 'EMPTY_BARCODE',
    BARCODE_EXISTS = 'BARCODE_EXISTS',
    QUARANTINE = 'QUARANTINE',
    ARCHIVED = 'ARCHIVED',
    OVERPRICED_WITH_STOCK = 'OVERPRICED_WITH_STOCK',
    PARTIAL_APPROVED = 'PARTIAL_APPROVED',
    IMAGE_ABSENT = 'IMAGE_ABSENT',
    MODERATION_BLOCK = 'MODERATION_BLOCK',
}
export type ProductVisibilityInterface = {
    [key in ProductVisibility]: string;
};

export class ProductVisibilityClass implements ProductVisibilityInterface {
    @ApiProperty({ description: 'все товары, кроме архивных.' })
    ALL: string;
    ARCHIVED: string;
    BANNED: string;
    BARCODE_EXISTS: string;
    CRITICALLY_OVERPRICED: string;
    DISABLED: string;
    EMPTY_BARCODE: string;
    EMPTY_STOCK: string;
    IMAGE_ABSENT: string;
    INVISIBLE: string;
    IN_SALE: string;
    MODERATED: string;
    MODERATION_BLOCK: string;
    NOT_MODERATED: string;
    OVERPRICED: string;
    OVERPRICED_WITH_STOCK: string;
    PARTIAL_APPROVED: string;
    QUARANTINE: string;
    READY_TO_SUPPLY: string;
    REMOVED_FROM_SALE: string;
    STATE_FAILED: string;
    TO_SUPPLY: string;
    VALIDATION_STATE_FAIL: string;
    VALIDATION_STATE_PENDING: string;
    VALIDATION_STATE_SUCCESS: string;
    VISIBLE: string;
}
export const ProductVisibilityValues: ProductVisibilityInterface = {
    [ProductVisibility.ALL]: 'все товары, кроме архивных.',
    [ProductVisibility.VISIBLE]: 'товары, которые видны покупателям.',
    [ProductVisibility.INVISIBLE]: 'товары, которые не видны покупателям.',
    [ProductVisibility.EMPTY_STOCK]: 'товары, у которых не указано наличие.',
    [ProductVisibility.NOT_MODERATED]: 'товары, которые не прошли модерацию.',
    [ProductVisibility.MODERATED]: 'товары, которые прошли модерацию.',
    [ProductVisibility.DISABLED]: 'товары, которые видны покупателям, но недоступны к покупке.',
    [ProductVisibility.STATE_FAILED]: 'товары, создание которых завершилось ошибкой.',
    [ProductVisibility.READY_TO_SUPPLY]: 'товары, готовые к поставке.',
    [ProductVisibility.VALIDATION_STATE_PENDING]: 'товары, которые проходят проверку валидатором на премодерации.',
    [ProductVisibility.VALIDATION_STATE_FAIL]: 'товары, которые не прошли проверку валидатором на премодерации.',
    [ProductVisibility.VALIDATION_STATE_SUCCESS]: 'товары, которые прошли проверку валидатором на премодерации.',
    [ProductVisibility.TO_SUPPLY]: 'товары, готовые к продаже.',
    [ProductVisibility.IN_SALE]: 'товары в продаже.',
    [ProductVisibility.REMOVED_FROM_SALE]: 'товары, скрытые от покупателей.',
    [ProductVisibility.BANNED]: 'заблокированные товары.',
    [ProductVisibility.OVERPRICED]: 'товары с завышенной ценой.',
    [ProductVisibility.CRITICALLY_OVERPRICED]: 'товары со слишком завышенной ценой.',
    [ProductVisibility.EMPTY_BARCODE]: 'товары без штрихкода.',
    [ProductVisibility.BARCODE_EXISTS]: 'товары со штрихкодом.',
    [ProductVisibility.QUARANTINE]: 'товары на карантине после изменения цены более чем на 50%.',
    [ProductVisibility.ARCHIVED]: 'товары в архиве.',
    [ProductVisibility.OVERPRICED_WITH_STOCK]: 'товары в продаже со стоимостью выше, чем у конкурентов.',
    [ProductVisibility.PARTIAL_APPROVED]: 'товары в продаже с пустым или неполным описанием.',
    [ProductVisibility.IMAGE_ABSENT]: 'товары без изображений.',
    [ProductVisibility.MODERATION_BLOCK]: 'товары, для которых заблокирована модерация.',
};
