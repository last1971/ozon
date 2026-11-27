import { Body, Controller, Get, Headers, HttpCode, ParseBoolPipe, ParseEnumPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ActionProductsPageParamsDto } from './dto/actionProductsPage.dto';
import { ActionsDto } from './dto/actions.dto';
import { PromoPriceStateRequestDto } from './dto/promoPrice.dto';
import { JobStateDto } from '../job/job.state.dto';
import { PromoPriceService } from './price-lever/promo-price.service';
import { PromoSweepService } from './price-lever/sweep/promo-sweep.service';
import { SWEEP_GOAL_KINDS, SweepGoalKind } from './price-lever/sweep/sweep-goal';
import { PromoPriceApplyResult, PromoPricePlan, PromoPriceState } from './price-lever/promo-price.types';
import { OzonPromosApi } from './promos.api';
import { PromosService } from './promos.service';

/** Ручки акций Ozon (только чтение) и цены по единому правилу. */
@ApiTags('promos')
@Controller('promos')
export class PromosController {
    constructor(
        private readonly service: PromosService,
        private readonly api: OzonPromosApi,
        private readonly promoPrice: PromoPriceService,
        private readonly sweep: PromoSweepService,
    ) {}

    @ApiOkResponse({ description: 'Список акций, в которых можно участвовать.', type: [ActionsDto] })
    @Get('actions')
    actions(): Promise<ActionsDto[]> {
        return this.service.getActions();
    }

    @ApiOkResponse({ description: 'Страница кандидатов в акцию (v2, пагинация по last_id).' })
    @Post('actions/candidates')
    actionsCandidates(@Query() params: ActionProductsPageParamsDto) {
        return this.api.page('candidates', params.action_id, params.last_id);
    }

    @ApiOkResponse({ description: 'Страница участников акции (v2, пагинация по last_id).' })
    @Post('actions/products')
    actionsProducts(@Query() params: ActionProductsPageParamsDto) {
        return this.api.page('products', params.action_id, params.last_id);
    }

    @ApiOperation({
        summary: 'Ozon: состояние товара в акциях',
        description:
            'Предельная цена, ограничение, наш процент, участие в акциях Ozon, цена покупателю. Ничего не меняет.',
    })
    @Post('ozon/price-state')
    @HttpCode(200)
    priceState(@Body() body: PromoPriceStateRequestDto): Promise<PromoPriceState[]> {
        return this.promoPrice.states(body.offer_ids);
    }

    @ApiOperation({
        summary: 'Ozon: план цены по правилу (dry-run)',
        description: 'Предельная цена под нашу минимальную с учётом процента нашей акции. Ничего не применяет.',
    })
    @Post('ozon/price-plan')
    @HttpCode(200)
    pricePlan(@Body() body: PromoPriceStateRequestDto): Promise<PromoPricePlan[]> {
        return this.promoPrice.plans(body.offer_ids);
    }

    @ApiOperation({
        summary: 'Ozon: применить цену по правилу',
        description: 'Читает состояние заново, считает план и отправляет процент нашей акции и цену. Ответ — итог по шагам.',
    })
    @Post('ozon/price-apply')
    @HttpCode(200)
    priceApply(@Body() body: PromoPriceStateRequestDto): Promise<PromoPriceApplyResult[]> {
        return this.promoPrice.apply(body.offer_ids);
    }

    @ApiOperation({
        summary: 'Ozon: сверка цен по правилу (фоновая задача)',
        description:
            'goal=below-min — товары, у которых цена покупателю ниже минимальной; goal=min — все, чья цена не по правилу. ' +
            'apply=false — только отчёт, apply=true — применить. Ход и отчёт — GET /job/:id.',
    })
    @ApiQuery({ name: 'apply', type: Boolean, required: false })
    @ApiQuery({ name: 'goal', enum: SWEEP_GOAL_KINDS, required: false })
    @ApiOkResponse({ type: JobStateDto })
    @Post('ozon/promo-sweep')
    @HttpCode(200)
    promoSweep(
        @Query('apply', new ParseBoolPipe({ optional: true })) apply?: boolean,
        @Query('goal', new ParseEnumPipe(Object.fromEntries(SWEEP_GOAL_KINDS.map((k) => [k, k])), { optional: true }))
        goal?: SweepGoalKind,
        @Headers('x-client-id') clientId?: string,
    ): JobStateDto {
        return this.sweep.start(Boolean(apply), goal ?? 'below-min', clientId || undefined);
    }
}
