import { ApiProperty } from '@nestjs/swagger';

export class MarkScanProgressLineDto {
    @ApiProperty() realpricecode: number;
    @ApiProperty() goodscode: string;
    @ApiProperty() quantityNeeded: number;
    @ApiProperty() quantityScanned: number;
    @ApiProperty({ description: 'Требуется ли скан КМ для этой строки' })
    requiresScan: boolean;
    @ApiProperty({ description: 'Скан завершён или не требуется' })
    isComplete: boolean;
}
