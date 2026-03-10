import { WbCardCharacteristicDto } from '../dto/wb.card.dto';

export enum WbCategoryMode {
    MANUAL = 'manual',
    BY_OZON_TYPE = 'byOzonType',
    BY_NAME = 'byName',
}

export interface WbCharc {
    charcID: number;
    name: string;
    required: boolean;
    unitName: string;
    maxCount: number;
    popular: boolean;
    charcType: number; // 1=string[], 4=number, 0=не используется
}

export interface IWbCreateCardContext {
    // Input
    productName: string;
    description: string;
    subjectId: number;
    webSearch?: boolean;

    // Input для createCard
    offerId?: string;
    categoryMode?: WbCategoryMode;
    submit?: boolean;

    // Ozon данные для программного заполнения (опционально)
    ozonDimensions?: string;  // attr 4382 "215x115x30"
    ozonWeight?: string;      // attr 4383 "827"
    ozonWarranty?: string;    // attr 4385 "14 дней"

    // Ozon card data (from FetchOzonCardCommand)
    ozonCard?: any;
    ozonName?: string;
    brand?: string;
    barcodes?: string[];
    ozonHeight?: number;       // mm
    ozonDepth?: number;        // mm
    ozonWidth?: number;        // mm
    ozonWeightGrams?: number;  // g
    typeId?: number;
    descriptionCategoryId?: number;

    // Pipeline — характеристики
    charcs?: WbCharc[];
    aiCharacteristics?: { id: number; value: number | string | string[] }[];
    characteristics?: WbCardCharacteristicDto[];
    aiCost?: { tokens: number; cost: number };

    // WB card building
    title?: string;
    uploadBody?: any;
    uploadResult?: any;

    // Chain control
    stopChain?: boolean;
    error_message?: string;
}

/** Характеристики, заполняемые программно (исключаем из AI промпта) */
export const WB_MANUAL_CHARC_NAMES = new Set([
    'Ставка НДС',
    'Высота предмета',
    'Глубина предмета',
    'Ширина предмета',
    'Вес товара без упаковки (г)',
    'Гарантийный срок',
]);
