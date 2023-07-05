import { ApiProperty } from '@nestjs/swagger';

export class ResultDto {
    @ApiProperty()
    isSuccess: boolean;
    @ApiProperty()
    message?: string;
}
