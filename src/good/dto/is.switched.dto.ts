import { IsBoolean, IsEnum } from 'class-validator';
import { GoodServiceEnum } from '../good.service.enum';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class IsSwitchedDto {
    @IsEnum(GoodServiceEnum)
    @ApiProperty({
        description: 'service name',
        enum: GoodServiceEnum,
    })
    service: GoodServiceEnum;
    @IsBoolean()
    @Transform(({ value }) => value === 'true')
    @ApiProperty({
        description: 'service state',
        type: 'boolean',
    })
    isSwitchedOn: boolean;
}
