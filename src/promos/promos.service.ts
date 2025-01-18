import { Injectable } from '@nestjs/common';
import { OzonApiService } from 'src/ozon.api/ozon.api.service';
import { ActionsDto } from './dto/actions.dto';
import { ActionsListDto } from './dto/actionsCandidate.dto';
import { ActionsListParamsDto } from './dto/actionsCandidateParams.dto';
import { ActivateActionProductsParamsDto } from './dto/activateActionProductsParams.dbo';
import { ActivateOrDeactivateActionProductsDto } from './dto/activateOrDeactivateActionProducts.dbo';
import { DeactivateActionProductsParamsDto } from './dto/deactivateActionProductsParams.dbo';

/**
 * Service responsible for handling promotional actions.
 *
 * @class PromosService
 * @implements {OnModuleInit}
 */
@Injectable()
/**
 * Service for handling promotional actions.
 */
export class PromosService {
    /**
     * Creates an instance of PromosService.
     *
     * @param {OzonApiService} ozonApiService - The Ozon API service.
     */
    constructor(private ozonApiService: OzonApiService) {}

    /**
     * Retrieves a list of actions.
     *
     * @returns {Promise<ActionsDto>} A promise that resolves to the list of actions.
     */
    async getActions(): Promise<ActionsDto> {
        const res = await this.ozonApiService.method('/v1/actions', {}, 'get');
        return res.result;
    }

    /**
     * Retrieves a list of action candidates based on the provided parameters.
     *
     * @param {ActionsListParamsDto} params - The parameters for retrieving action candidates.
     * @returns {Promise<ActionsListDto>} A promise that resolves to the list of action candidates.
     */
    async getActionsCandidates(params: ActionsListParamsDto): Promise<ActionsListDto> {
        const res = await this.ozonApiService.method('/v1/actions/candidates', params);
        return res.result;
    }

    /**
     * Retrieves a list of action products based on the provided parameters.
     *
     * @param {ActionsListParamsDto} params - The parameters for retrieving action products.
     * @returns {Promise<ActionsListDto>} A promise that resolves to the list of action products.
     */
    async getActionsProducts(params: ActionsListParamsDto): Promise<ActionsListDto> {
        const res = await this.ozonApiService.method('/v1/actions/products', params);
        return res.result;
    }

    /**
     * Activates action products based on the provided parameters.
     *
     * @param {ActivateActionProductsParamsDto} params - The parameters for activating action products.
     * @returns {Promise<ActivateOrDeactivateActionProductsDto>} A promise that resolves to the activation result.
     */
    async activateActionProducts(
        params: ActivateActionProductsParamsDto,
    ): Promise<ActivateOrDeactivateActionProductsDto> {
        const res = await this.ozonApiService.method('/v1/actions/products/activate', params);
        return res.result;
    }

    /**
     * Deactivates action products based on the provided parameters.
     *
     * @param {DeactivateActionProductsParamsDto} params - The parameters for deactivating action products.
     * @returns {Promise<ActivateOrDeactivateActionProductsDto>} A promise that resolves to the deactivation result.
     */
    async deactivateActionProducts(
        params: DeactivateActionProductsParamsDto,
    ): Promise<ActivateOrDeactivateActionProductsDto> {
        const res = await this.ozonApiService.method('/v1/actions/products/activate', params);
        return res.result;
    }
}
