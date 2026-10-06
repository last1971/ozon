import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ActionProductsPageParamsDto } from './dto/actionProductsPage.dto';
import { ActionsDto } from './dto/actions.dto';
import { AddRemoveProductToActionsParamsDto } from './dto/addRemoveProductToActionsParams.dto';
import { OzonPromosApi } from './promos.api';
import { AddRemoveProductToAction, FitProductsStrategy, PromosService } from './promos.service';

/** Ручки акций: чтение — прямо из шлюза API, действия — через бизнес-правила PromosService. */
@ApiTags('promos')
@Controller('promos')
export class PromosController {
    constructor(
        private readonly service: PromosService,
        private readonly api: OzonPromosApi,
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
}
