import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MpService } from '../../mp-event/mp-event.service';

/**
 * Строка возврата маркетплейса в общем виде: один товар одного возврата.
 * Команды приёма видят только её и счёт — от маркетплейса они не зависят.
 */
export class ReturnLineDto {
    @ApiProperty({ enum: ['OZON', 'WB', 'YANDEX'] }) service: MpService;
    @ApiProperty({ description: 'id возврата у маркетплейса' }) extId: string;
    @ApiProperty({ description: 'Номер отправления' }) posting: string;
    @ApiProperty({ description: 'Артикул продавца, может нести фасовку: 524924-10' }) offerId: string;
    @ApiPropertyOptional() productName: string | null;
    @ApiProperty({ description: 'Сколько юнитов маркетплейса вернулось' }) units: number;
    @ApiPropertyOptional() reason: string | null;
    @ApiProperty({ description: 'Возврат после выкупа (иначе отмена до выкупа)' }) isBuyout: boolean;
    @ApiProperty({ description: 'Покупатель вскрывал упаковку' }) isOpened: boolean;
    @ApiPropertyOptional({ description: 'Когда маркетплейс отметил «получен продавцом»' }) receivedAt: string | null;
    @ApiPropertyOptional({ description: 'Штрихкод возвратной этикетки' }) barcode: string | null;
    @ApiPropertyOptional({ description: 'FBS / FBO' }) schema: string | null;
    @ApiPropertyOptional({ description: 'Статус возврата словами маркетплейса' }) stateName: string | null;
}
