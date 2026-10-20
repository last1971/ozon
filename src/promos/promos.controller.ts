import { Body, Controller, Get, Headers, HttpCode, ParseBoolPipe, ParseEnumPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ActionProductsPageParamsDto } from './dto/actionProductsPage.dto';
import { ActionsDto } from './dto/actions.dto';
import { AddRemoveProductToActionsParamsDto } from './dto/addRemoveProductToActionsParams.dto';
import { PromoPricePlanRequestDto, PromoPriceStateRequestDto } from './dto/promoPrice.dto';
import { JobStateDto } from '../job/job.state.dto';
import { PromoPriceService } from './price-lever/promo-price.service';
import { PromoSweepService } from './price-lever/sweep/promo-sweep.service';
import { SWEEP_GOAL_KINDS, SweepGoalKind } from './price-lever/sweep/sweep-goal';
import { PromoPriceApplyResult, PromoPricePlan, PromoPriceState } from './price-lever/promo-price.types';
import { OzonPromosApi } from './promos.api';
import { AddRemoveProductToAction, FitProductsStrategy, PromosService } from './promos.service';

/** Ручки акций: чтение — прямо из шлюза API, действия — через бизнес-правила PromosService. */
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

    @ApiOkResponse({
        description: 'Снять с акции товары с ценой ниже нашей минимальной или без остатка.',
        type: Number,
    })
    @ApiQuery({ name: 'actionId', type: Number, required: true })
    @Get('actions/products/unfit-removal')
    unfitProductsRemoval(@Query('actionId') actionId: number): Promise<number> {
        return this.service.unfitProductsRemoval(Number(actionId));
    }

    @ApiOkResponse({ description: 'Добавить в акцию подходящих кандидатов по стратегии цены.', type: Number })
    @ApiQuery({ name: 'actionId', type: Number, required: true })
    @ApiQuery({
        name: 'strategy',
        description: 'max_action_price | max(action_price, min_price) | min_price',
        enum: FitProductsStrategy,
        required: true,
    })
    @Get('actions/products/fit-addition')
    fitProductsAddition(
        @Query('actionId') actionId: number,
        @Query('strategy') strategy: FitProductsStrategy,
    ): Promise<number> {
        return this.service.fitProductsAddition(Number(actionId), strategy);
    }

    @ApiOkResponse({ description: 'Пересмотр участия товаров во всех акциях по их ценам.', type: [Object] })
    @Post('actions/products/add-remove')
    addRemoveProductToActions(
        @Query() params: AddRemoveProductToActionsParamsDto,
    ): Promise<AddRemoveProductToAction[]> {
        return this.service.addRemoveProductToActions(params.ids, params.chunkLimit);
    }

    @ApiOperation({
        summary: 'Ozon: состояние товара в акциях',
        description:
            'Цены, наш процент, Ozon-акции (участник/кандидат, цена, лимит), цена покупателю. Ничего не меняет. ~40 запросов к Ozon.',
    })
    @Post('ozon/price-state')
    @HttpCode(200)
    priceState(@Body() body: PromoPriceStateRequestDto): Promise<PromoPriceState[]> {
        return this.promoPrice.states(body.offer_ids);
    }

    @ApiOperation({
        summary: 'Ozon: план цены через акции (dry-run)',
        description:
            'Шаги: цена в Ozon-акции / выкинуть из Ozon-акции / процент нашей акции, итог покупателю. Ничего не применяет.',
    })
    @Post('ozon/price-plan')
    @HttpCode(200)
    pricePlan(@Body() body: PromoPricePlanRequestDto): Promise<PromoPricePlan[]> {
        return this.promoPrice.plans(body.offer_ids, PromoPriceService.parseTarget(body.target), body.percent);
    }

    @ApiOperation({
        summary: 'Ozon: применить план цены через акции',
        description:
            'Читает состояние заново, считает план и выполняет шаги: сначала Ozon-акции, потом процент нашей акции. ' +
            'Повышение процента пропускается, если шаг по Ozon-акции не прошёл. Ответ — итог по каждому шагу.',
    })
    @Post('ozon/price-apply')
    @HttpCode(200)
    priceApply(@Body() body: PromoPricePlanRequestDto): Promise<PromoPriceApplyResult[]> {
        return this.promoPrice.apply(body.offer_ids, PromoPriceService.parseTarget(body.target), body.percent);
    }

    @ApiOperation({
        summary: 'Ozon: сверка акций по цели (фоновая задача)',
        description:
            'goal=below-min — товары, у которых цена покупателю ниже min_price (процент — минимум нашей акции); ' +
            'goal=min|normal — цена покупателю не равна минимальной/нормальной, план приводит к ней в обе стороны. ' +
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
