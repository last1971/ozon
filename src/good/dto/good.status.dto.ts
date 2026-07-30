import { ApiProperty } from '@nestjs/swagger';
import { GoodServiceEnum } from '../good.service.enum';

/** Статус одного сервиса: включён/выключен. */
export class ServiceStatusDto {
    @ApiProperty({ enum: GoodServiceEnum })
    service: GoodServiceEnum;

    @ApiProperty({ description: 'Сервис включён (остатки синхронизируются).' })
    isSwitchedOn: boolean;
}

/** Отключённый код: весь товар (good) или конкретная фасовка (sku). */
export class DisabledCodeDto {
    @ApiProperty({ description: 'GOODSCODE или SKU.' })
    code: string;

    @ApiProperty({ enum: ['good', 'sku'] })
    level: 'good' | 'sku';
}

/** Сводка по сервису: вкл/выкл + активные/замороженные товары. */
export class GoodsServiceStatusDto {
    @ApiProperty({ description: 'Сервис включён.' })
    isSwitchedOn: boolean;

    @ApiProperty({ description: 'Всего SKU в сервисе.' })
    total: number;

    @ApiProperty({ description: 'Активных SKU (не замороженных).' })
    active: number;

    @ApiProperty({ description: 'Замороженные коды с уровнем.', type: [DisabledCodeDto] })
    disabled: DisabledCodeDto[];
}
