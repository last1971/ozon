import { Controller, Inject, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { GoodPercentDto } from './dto/good.percent.dto';
@ApiTags('good')
@Controller('api/good')
export class GoodController {
    constructor(@Inject(GOOD_SERVICE) private goodService: IGood) {}
    @Post('percent')
    async setPercent(@Query() percent: GoodPercentDto): Promise<void> {
        await this.goodService.setPercents(percent);
    }
}
