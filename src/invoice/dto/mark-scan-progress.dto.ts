import { ApiProperty } from '@nestjs/swagger';
import { MarkScanProgressLineDto } from './mark-scan-progress-line.dto';

export class MarkScanProgressDto {
    @ApiProperty({ type: [MarkScanProgressLineDto] })
    lines: MarkScanProgressLineDto[];

    @ApiProperty({ description: 'Можно ли завершать сборку (FINISH_PICKUP)' })
    isReadyToFinish: boolean;

    @ApiProperty({ type: [String], description: 'KI всех привязанных к счёту КМ (TT=3)' })
    attachedKis: string[];
}
