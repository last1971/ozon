import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FitProductsStrategy, PromosService, AddRemoveProductToAction } from './promos.service';
import { ActionsDto } from './dto/actions.dto';
import { ActionsListParamsDto } from './dto/actionsCandidateParams.dto';
import { ActionsListDto } from './dto/actionsCandidate.dto';
import { ActivateActionProductsParamsDto } from './dto/activateActionProductsParams.dbo';
import { ActivateOrDeactivateActionProductsDto } from './dto/activateOrDeactivateActionProducts.dbo';
import { DeactivateActionProductsParamsDto } from './dto/deactivateActionProductsParams.dbo';
import { AddRemoveProductToActionsParamsDto } from './dto/addRemoveProductToActionsParams.dto';

/**
 * Controller for handling promo-related endpoints.
 */
@ApiTags('promos')
@Controller('promos')
/**
 * Controller for handling promotional actions and products.
 */
export class PromosController {
    /**
     * Creates an instance of PromosController.
     * @param {PromosService} service - An instance of PromosService
     */
    constructor(private service: PromosService) {}

    /**
     * Retrieves a list of actions that users can participate in.
     * @returns {Promise<ActionsDto>} A promise that resolves to an ActionsDto object.
     */
    @ApiOkResponse({
        description: 'Метод для получения списка акций, в которых можно участвовать.',
        type: ActionsDto,
    })
    @Get('actions')
    async actions(): Promise<ActionsDto[]> {
        return this.service.getActions();
    }

    /**
     * Retrieves a list of products that can participate in an action, based on the action's identifier.
     * @param {ActionsListParamsDto} params - The parameters for filtering the list of candidate products.
     * @returns {Promise<ActionsListDto>} A promise that resolves to an ActionsListDto object.
     */
    @ApiOkResponse({
        description: 'Метод для получения списка товаров, которые могут участвовать в акции, по её идентификатору.',
        type: ActionsListDto,
    })
    @Post('actions/candidates')
    async actionsCandidates(@Query() params: ActionsListParamsDto): Promise<ActionsListDto> {
        return this.service.getActionsCandidates(params);
    }

    /**
     * Retrieves a list of products participating in an action, based on the action's identifier.
     * @param {ActionsListParamsDto} params - The parameters for filtering the list of participating products.
     * @returns {Promise<ActionsListDto>} A promise that resolves to an ActionsListDto object.
     */
    @ApiOkResponse({
        description: 'Метод для получения списка товаров, участвующих в акции, по её идентификатору.',
        type: ActionsListDto,
    })
    @Post('actions/products')
    async actionsProducts(@Query() params: ActionsListParamsDto): Promise<ActionsListDto> {
        return this.service.getActionsProducts(params);
    }

    /**
     * Adds products to an available action.
     * @param {ActivateActionProductsParamsDto} params - The parameters for activating products in an action.
     * @returns {Promise<ActivateOrDeactivateActionProductsDto>} A promise that resolves to an ActivateOrDeactivateActionProductsDto object.
     */
    @ApiOkResponse({
        description: 'Метод для добавления товаров в доступную акцию.',
        type: ActivateOrDeactivateActionProductsDto,
    })
    @Post('actions/products/activate')
    async activateActionProducts(
        @Query() params: ActivateActionProductsParamsDto,
    ): Promise<ActivateOrDeactivateActionProductsDto> {
        return this.service.activateActionProducts(params);
    }

    /**
     * Removes products from an action.
     * @param {DeactivateActionProductsParamsDto} params - The parameters for deactivating products in an action.
     * @returns {Promise<ActivateOrDeactivateActionProductsDto>} A promise that resolves to an ActivateOrDeactivateActionProductsDto object.
     */
    @ApiOkResponse({
        description: 'Метод для удаления товаров из акции.',
        type: ActivateOrDeactivateActionProductsDto,
    })
    @Post('actions/products/deactivate')
    async deactivateActionProducts(
        @Query() params: DeactivateActionProductsParamsDto,
    ): Promise<ActivateOrDeactivateActionProductsDto> {
        return this.service.deactivateActionProducts(params);
    }

    /**
     * Removes unfit products from an action.
     * @param {number} actionId - The parameters for deactivating products in an action.
     * @returns {number} A promise that resolves to an unfit count.
     */
    @ApiOkResponse({
        description: 'Метод для удаления неподходящих товаров из акции по её id.',
        type: Number,
    })
    @ApiQuery({
        name: 'actionId',
        description: 'ID акции, для которой требуется удалить неподходящие товары.',
        type: Number,
        required: true,
    })
    @Get('actions/products/unfit-removal')
    async unfitProductsRemoval(@Query('actionId') actionId: number): Promise<number> {
        return this.service.unfitProductsRemoval(actionId);
    }

    /**
     * Add fit products to action.
     * @param {number} actionId - The parameters for activating products in an action.
     * @param {number} strategy - The parameters for strategy choise.
     * @returns {number} A promise that resolves to an fit count.
     */
    @ApiOkResponse({
        description: 'Метод для добавления подходящих товаров в акцию по её id.',
        type: Number,
    })
    @ApiQuery({
        name: 'actionId',
        description: 'ID акции, для которой требуется добавить подходящие товары.',
        type: Number,
        required: true,
    })
    @ApiQuery({
        name: 'strategy',
        description:
            'Стратегия ценообразования: max_action_price | max(action_price, цена.price.min_price) | цена.price.min_price',
            enum: FitProductsStrategy,
        required: true,
    })
    @Get('actions/products/fit-addition')
    async fitProductsAddition(
        @Query('actionId') actionId: number,
        @Query('strategy') strategy: FitProductsStrategy,
    ): Promise<number> {
        return this.service.fitProductsAddition(actionId, strategy);
    }

    /**
     * Добавляет и удаляет товары в акциях на основе их цен.
     * @param {AddRemoveProductToActionsParamsDto} params - Параметры для добавления и удаления товаров.
     * @returns {Promise<AddRemoveProductToAction[]>} Промис, который возвращает массив результатов по каждой акции.
     */
    @ApiOkResponse({
        description: 'Метод для добавления и удаления товаров в акциях на основе их цен.',
        type: [Object],
    })
    @Post('actions/products/add-remove')
    async addRemoveProductToActions(
        @Query() params: AddRemoveProductToActionsParamsDto,
    ): Promise<AddRemoveProductToAction[]> {
        return this.service.addRemoveProductToActions(params.ids, params.chunkLimit);
    }
}
