import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PromosService } from './promos.service';
import { ActionsDto } from './dto/actions.dto';
import { ActionsListParamsDto } from './dto/actionsCandidateParams.dto';
import { ActionsListDto } from './dto/actionsCandidate.dto';
import { ActivateActionProductsParamsDto } from './dto/activateActionProductsParams.dbo';
import { ActivateOrDeactivateActionProductsDto } from './dto/activateOrDeactivateActionProducts.dbo';
import { DeactivateActionProductsParamsDto } from './dto/deactivateActionProductsParams.dbo';

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
    async actions(): Promise<ActionsDto> {
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
    @Get('actions/candidates')
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
    @Get('actions/products')
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
    @Get('actions/products/activate')
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
    @Get('actions/products/deactivate')
    async deactivateActionProducts(
        @Query() params: DeactivateActionProductsParamsDto,
    ): Promise<ActivateOrDeactivateActionProductsDto> {
        return this.service.deactivateActionProducts(params);
    }
}
