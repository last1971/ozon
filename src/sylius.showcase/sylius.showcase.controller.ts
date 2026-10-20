import { Controller, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ShowcaseRunResult, SyliusShowcaseService } from './sylius.showcase.service';

@ApiTags('showcase')
@Controller('showcase')
export class SyliusShowcaseController {
    constructor(private readonly showcase: SyliusShowcaseService) {}

    @ApiOperation({
        summary: 'Витрины сайта: отправить списки в Sylius руками',
        description:
            'new, hits и arrivals считаются по Trade заново; deals — последний расчёт с полной отправки цен ' +
            '(POST /price/all/sylius), здесь только переотправляется. dryRun=1 — посчитать и вернуть коды, не отправлять.',
    })
    @ApiQuery({ name: 'dryRun', required: false, description: '1 / true — без отправки' })
    @ApiQuery({
        name: 'list',
        required: false,
        description: 'какие списки через запятую: new,hits,arrivals,deals; пусто — все',
    })
    @Post('sylius')
    @HttpCode(200)
    sylius(@Query('dryRun') dryRun?: string, @Query('list') list?: string): Promise<ShowcaseRunResult> {
        return this.showcase.run(
            ['1', 'true', 'yes'].includes(String(dryRun ?? '').toLowerCase()),
            SyliusShowcaseService.parseLists(list),
        );
    }
}
