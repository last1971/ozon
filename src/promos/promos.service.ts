import { Injectable } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ActionsDto } from './dto/actions.dto';
import { ActionListProduct, ActionsListDto } from './dto/actionsCandidate.dto';
import { ActionsListParamsDto } from './dto/actionsCandidateParams.dto';
import { ActivateActionProduct, ActivateActionProductsParamsDto } from './dto/activateActionProductsParams.dbo';
import { ActivateOrDeactivateActionProductsDto } from './dto/activateOrDeactivateActionProducts.dbo';
import { DeactivateActionProductsParamsDto } from './dto/deactivateActionProductsParams.dbo';
import { ProductService } from '../product/product.service';
import { PriceRequestDto } from '../price/dto/price.request.dto';
import { ProductVisibility } from '../product/product.visibility';
import { ProductPriceDto } from 'src/price/dto/product.price.dto';

export type FitProductsStrategy = 'maxActionPrice' | 'maxFromActionActionPiceAndProdMinPrice' | 'minFromProdMinPrice';

/**
 * Service responsible for handling promotional actions.
 *
 * @class PromosService
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
     * @param productService
     */
    constructor(
        private ozonApiService: OzonApiService,
        private productService: ProductService,
    ) {}

    /**
     * Retrieves a list of actions.
     *
     * @returns {Promise<ActionsDto>} A promise that resolves to the list of actions.
     */
    async getActions(): Promise<ActionsDto[]> {
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
        const res = await this.ozonApiService.method('/v1/actions/products/deactivate', params);
        return res.result;
    }

    /**
     * Removes unfit products from an action based on their prices.
     *
     * This method retrieves all products associated with a given action, checks their prices,
     * and deactivates those that do not meet the required price criteria.
     *
     * @param {number} actionId - The ID of the action from which unfit products should be removed.
     * @returns {Promise<number>} - A promise that resolves to the number of products that were deactivated.
     *
     * @throws {Error} - Throws an error if there is an issue retrieving products or prices, or deactivating products.
     */
    async unfitProductsRemoval(actionId: number): Promise<number> {
        const actionProducts = await this.getAllActionsProductsOrCandidates(actionId, 'products');
        const productsPrice = await this.getProductsPrices(actionProducts);
        const unfitProductIds = actionProducts
            .filter((actionProduct) => {
                const productPrice = productsPrice.find((p) => p.id === actionProduct.id);
                return productPrice && actionProduct.action_price < Number(productPrice.price.min_price);
            })
            .map((p) => p.id);
        await this.deactivateActionProducts({ action_id: actionId, product_ids: unfitProductIds });
        return unfitProductIds.length;
    }

    /**
     * Fits products addition to an action based on the provided strategy.
     *
     * This method retrieves all products associated with a given action, checks their prices,
     * and activates those that meet the required price criteria based on the provided strategy.
     *
     * @param {number} actionId - The ID of the action to which products should be added.
     * @param {FitProductsStrategy} strategy - The strategy to use when adding products.
     * @returns {Promise<number>} - A promise that resolves to the number of products that were activated.
     *
     * @throws {Error} - Throws an error if there is an issue retrieving products or prices, or activating products.
     */
    async fitProductsAddition(actionId: number, strategy: FitProductsStrategy): Promise<number> {
        const actionCandidates = await this.getAllActionsProductsOrCandidates(actionId, 'candidates');
        const candidatesPrice = await this.getProductsPrices(actionCandidates);
        const fitProductIds = actionCandidates
            .filter((actionProduct) => {
                const minPrice = Number(
                    candidatesPrice.find((product) => product.id === actionProduct.id)?.price.min_price,
                );
                return minPrice && actionProduct.max_action_price && actionProduct.max_action_price >= minPrice;
            })
            .map((p) => p.id);
        const products: ActivateActionProduct[] = fitProductIds
            .map((id) => ({
                product_id: id,
                action_price:
                    strategy === 'maxActionPrice'
                        ? actionCandidates.find((p) => p.id === id).max_action_price
                        : strategy === 'maxFromActionActionPiceAndProdMinPrice'
                          ? Math.max(
                                actionCandidates.find((p) => p.id === id)?.action_price ?? 0,
                                Number(candidatesPrice.find((p) => p.id === id)?.price.min_price ?? 0),
                            )
                          : Number(candidatesPrice.find((p) => p.id === id)?.price.min_price ?? 0),
                stock: actionCandidates.find((p) => p.id === id)?.stock ?? 0, //TODO: additional rules
            }))
            .filter((p) => p.action_price > 0 && p.stock > 0);
        await this.activateActionProducts({ action_id: actionId, products });
        return fitProductIds.length;
    }

    /**
     * Retrieves the prices for a list of action products, with pagination support.
     *
     * @param {ActionListProduct[]} actionProducts - The list of action products to retrieve prices for.
     * @param {number} [limit=100] - The maximum number of products to process per request.
     * @returns {Promise<{ id: number; price: ProductPriceDto['price'] }[]>} A promise that resolves to an array of objects containing product IDs and their corresponding prices.
     */
    async getProductsPrices(
        actionProducts: ActionListProduct[],
        limit: number = 100,
    ): Promise<{ id: number; price: ProductPriceDto['price'] }[]> {
        const productPrices: { id: number; price: ProductPriceDto['price'] }[] = [];
        const pages = Math.ceil(actionProducts.length / limit);
        for (let i = 0; i < pages; i++) {
            const chunk = actionProducts.slice(i * limit, (i + 1) * limit);
            const priceRequest: PriceRequestDto = {
                product_id: chunk.map((product) => product.id),
                visibility: ProductVisibility.ALL,
                limit,
            };
            const pricesChunk = await this.productService.getPrices(priceRequest);
            productPrices.push(...pricesChunk.items.map((item) => ({ id: item.product_id, price: item.price })));
        }
        return productPrices;
    }

    /**
     * Retrieves all products associated with a given action, with pagination support.
     *
     * @param {number} actionId - The ID of the action to retrieve products for.
     * @param {'products' | 'candidates'} type - The type of products to retrieve.
     * @param {number} [limit=100] - The maximum number of products to process per request.
     * @returns {Promise<ActionListProduct[]>} A promise that resolves to an array of action products.
     */
    async getAllActionsProductsOrCandidates(
        actionId: number,
        type: 'products' | 'candidates',
        limit: number = 100,
    ): Promise<ActionListProduct[]> {
        let offset = 0;
        let { products: actionProducts, total } =
            type === 'candidates'
                ? await this.getActionsCandidates({ action_id: actionId, limit, offset })
                : await this.getActionsProducts({ action_id: actionId, limit, offset });
        while (total > actionProducts.length) {
            offset += limit;
            const nextProducts =
                type === 'products'
                    ? await this.getActionsProducts({ action_id: actionId, limit, offset })
                    : await this.getActionsCandidates({ action_id: actionId, limit, offset });
            actionProducts = actionProducts.concat(nextProducts.products);
        }
        return actionProducts;
    }
}
