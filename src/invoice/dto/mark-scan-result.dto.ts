import { ApiProperty } from '@nestjs/swagger';
import { MarkScanProgressDto } from './mark-scan-progress.dto';

class AttachedDto {
    @ApiProperty() ki: string;
    @ApiProperty() goodscode: string;
    @ApiProperty() realpricecode: number;
}

export class MarkScanResultDto {
    @ApiProperty({ type: AttachedDto })
    attached: AttachedDto;

    @ApiProperty({ type: MarkScanProgressDto })
    progress: MarkScanProgressDto;
}
