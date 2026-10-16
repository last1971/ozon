import { ApiProperty } from '@nestjs/swagger';

/** Кнопка «Пересортица и подбор» на строке счёта с недобором, когда доноров нет. */
export class FboShortagePeresortDto {
    @ApiProperty({ description: 'Счёт-приёмник (S.SCODE) из предложения GET /api/invoice/donors/:posting' })
    scode: number;
    @ApiProperty({ description: 'Строка счёта с недобором (REALPRICE.REALPRICECODE)' }) realpricecode: number;
    @ApiProperty({ description: 'Кто оформляет — в документ списания и подборку' }) username: string;
}

export class FboShortagePeresortResultDto {
    @ApiProperty() posting: string;
    @ApiProperty() scode: number;
    @ApiProperty() realpricecode: number;
    @ApiProperty() goodscode: string;
    @ApiProperty({ description: 'Оприходовано пересортицей и подобрано, шт' }) quantity: number;
    @ApiProperty({ description: 'Номер документа списания (с минусом — приход пересортицей)' }) spisCode: number;
    @ApiProperty({ description: 'Недобора по счёту не осталось — журнал чист' }) shortageClosed: boolean;
    @ApiProperty({ description: 'Счёт отдан в подбор' }) pickedUp: boolean;
}
