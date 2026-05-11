import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MarkScanDto {
    @ApiProperty({ description: 'Полный код маркировки со сканера (KI + крипто-хвост)' })
    @IsString()
    @IsNotEmpty()
    ki: string;
}
