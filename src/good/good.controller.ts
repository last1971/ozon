import { Controller, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { GoodPercentDto } from './dto/good.percent.dto';
import { ResultDto } from '../helpers/result.dto';
import { GoodWbDto } from './dto/good.wb.dto';
import { ExtraGoodService } from './extra.good.service';
import { GoodServiceEnum } from './good.service.enum';
import { IsSwitchedDto } from './dto/is.switched.dto';
import { IsEnum } from 'class-validator';

class UpdateServiceParams {
    @IsEnum(GoodServiceEnum)
    @ApiProperty({
        description: 'service name',
        enum: GoodServiceEnum,
    })
    service: GoodServiceEnum;
}

@ApiTags('good')
@Controller('api/good')
export class GoodController {
    constructor(
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private extraService: ExtraGoodService,
    ) {}
    @Post('percent')
    async setPercent(@Query() percent: GoodPercentDto): Promise<void> {
        await this.goodService.setPercents(percent, null);
    }
    @Put('update/:service')
    async updateService(@Param() params: UpdateServiceParams): Promise<ResultDto> {
        return this.extraService.updateService(params.service);
    }
    @Put('wb')
    async setWb(@Query() dto: GoodWbDto): Promise<void> {
        await this.goodService.setWbData(dto, null);
    }

    @Post('is-switched')
    async isSwitched(@Query() isSwitchedDto: IsSwitchedDto): Promise<ResultDto> {
        return this.extraService.serviceIsSwitchedOn(isSwitchedDto);
    }
}
