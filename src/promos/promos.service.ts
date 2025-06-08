import { Injectable } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ActionsDto } from './dto/actions.dto';
import { ActionListProduct, ActionsListDto } from './dto/actionsCandidate.dto';
import { ActionsListParamsDto } from './dto/actionsCandidateParams.dto';
import { ActivateActionProduct, ActivateActionProductsParamsDto } from './dto/activateActionProductsParams.dbo';
import { ActivateOrDeactivateActionProductsDto, RejectedProduct } from './dto/activateOrDeactivateActionProducts.dbo';
import { DeactivateActionProductsParamsDto } from './dto/deactivateActionProductsParams.dbo';
import { ProductService } from '../product/product.service';
import { PriceRequestDto } from '../price/dto/price.request.dto';
import { ProductVisibility } from '../product/product.visibility';
import { ProductPriceDto } from '../price/dto/product.price.dto';
import { PriceService } from '../price/price.service';
import { PriceResponseDto } from '../price/dto/price.response.dto';
import { PriceDto } from 'src/price/dto/price.dto';

export enum FitProductsStrategy {
    MAX_ACTION_PRICE = 'maxActionPrice',
    MAX_FROM_ACTION_PRICE_AND_MIN_PRICE = 'maxFromActionActionPiceAndProdMinPrice',
    MIN_FROM_MIN_PRICE = 'minFromProdMinPrice',
}

export type AddRemoveProductToAction = {
    action_id: number;
    added: {
        success_ids: number[];
        failed: RejectedProduct[];
    };
    removed: {
        success_ids: number[];
        failed: RejectedProduct[];
    };
};
/**
 * Splits an array into chunks of a specified size.
 *
 * @template T - The type of elements in the input array.
 * @param arr - The array to be split into chunks.
 * @param chunkSize - The maximum size of each chunk.
 * @returns An array of arrays, where each sub-array is a chunk of the original array.
 *
 * @example
 * ```typescript
 * chunkArray([1, 2, 3, 4, 5], 2); // [[1, 2], [3, 4], [5]]
 * ```
 */
export function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
    return arr.reduce((acc, _, i) => {
        if (i % chunkSize === 0) acc.push(arr.slice(i, i + chunkSize));
        return acc;
    }, [] as T[][]);
}

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
        private priceService: PriceService,
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
        const productsCount = await this.productService.getFreeProductCount(actionProducts.map((p) => p.id));
        const unfitProductIds = actionProducts
            .filter((actionProduct) => {
                const productPrice = productsPrice.find((p) => p.id === actionProduct.id);
                const productCount = productsCount.find((p) => p.id === actionProduct.id);
                return (
                    productPrice &&
                    (actionProduct.action_price < Number(productPrice.price.min_price) || productCount.count === 0)
                );
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
        const candidatesCount = await this.productService.getFreeProductCount(actionCandidates.map((p) => p.id));
        const fitProductIds = actionCandidates
            .filter((actionProduct) => {
                const minPrice = Number(
                    candidatesPrice.find((product) => product.id === actionProduct.id)?.price.min_price,
                );
                const count = candidatesCount.find((product) => product.id === actionProduct.id)?.count;
                return (
                    minPrice &&
                    actionProduct.max_action_price &&
                    actionProduct.max_action_price >= minPrice &&
                    count > 0
                );
            })
            .map((p) => p.id);
        const products: ActivateActionProduct[] = fitProductIds
            .map((id) => ({
                product_id: id,
                action_price:
                    strategy === FitProductsStrategy.MAX_ACTION_PRICE
                        ? actionCandidates.find((p) => p.id === id).max_action_price
                        : strategy === FitProductsStrategy.MAX_FROM_ACTION_PRICE_AND_MIN_PRICE
                          ? Math.max(
                                actionCandidates.find((p) => p.id === id)?.action_price ?? 0,
                                Number(candidatesPrice.find((p) => p.id === id)?.price.min_price ?? 0),
                            )
                          : Number(candidatesPrice.find((p) => p.id === id)?.price.min_price ?? 0),
                stock: actionCandidates.find((p) => p.id === id)?.stock ?? 0, //TODO: additional rules
            }))
            .filter((p) => p.action_price > 0);
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
        let actionProducts: ActionListProduct[] = [];
        let isMoreDataAvailable = true;

        // Helper function to fetch data based on type
        const fetchProducts = async () =>
            type === 'candidates'
                ? this.getActionsCandidates({ action_id: actionId, limit, offset })
                : this.getActionsProducts({ action_id: actionId, limit, offset });

        while (isMoreDataAvailable) {
            const { products } = await fetchProducts();
            actionProducts = actionProducts.concat(products);
            offset += limit;

            // Если количество возвращённых продуктов меньше лимита, больше данных нет
            isMoreDataAvailable = products.length === limit;
        }

        return actionProducts;
    }

    async getActionListProduct(
        source: (params: ActionsListParamsDto) => Promise<ActionsListDto>,
        action_id: number,
        limit: number,
    ): Promise<ActionListProduct[]> {
        const result: ActionListProduct[] = [];
        let offset = 0;
        let _total: number;
        while (_total === undefined || offset >= _total) {
            const actionsListParams: ActionsListParamsDto = { action_id, limit, offset };
            const { products, total } = await source(actionsListParams);
            result.push(...products);
            if (_total === undefined) _total = total;
            offset += products.length;
        }

        return result;
    }

    async addRemoveProductToActions(ids: string[], chunkLimit: number = 100): Promise<AddRemoveProductToAction[]> {
        // возвращаемое значение
        const result: AddRemoveProductToAction[] = [];
        // получаем список акций
        const actions = await this.getActions();
        // чанкаем реквесты на получение цен
        const chunkedIds = chunkArray(ids, chunkLimit);
        const requests = chunkedIds.map(
            (chunk) => <PriceRequestDto>{ offer_id: chunk, visibility: ProductVisibility.ALL, limit: chunkLimit },
        );
        // собираем массив PriceResponseDto
        const priceResponses: PriceResponseDto[] = await Promise.all(
            requests.map((chunk) => this.priceService.index(chunk)),
        );
        // мапим из него массив цен
        const prices: PriceDto[] = priceResponses.map((p) => p.data).flat();
        // для каждой акции
        for (const action of actions) {
            // получаем товары, которые участвуют (getActionsProducts)
            const productsInAction: ActionListProduct[] = await this.getActionListProduct(
                this.getActionsProducts,
                action.id,
                chunkLimit,
            );
            // получаем товары, которые можно добавить (getActionsCandidates)
            const productsCanPromoted: ActionListProduct[] = await this.getActionListProduct(
                this.getActionsCandidates,
                action.id,
                chunkLimit,
            );
            const removeList: PriceDto[] = [];
            const addList: PriceDto[] = [];
            // для каждого товара из списка прайсов
            for (const price of prices) {
                // если product_id в акции и actionRec.price <=❗️ price.min_price
                // то вносим в список на исключение
                const productInAction = productsInAction.find((p) => p.id === price.product_id);
                if (productInAction && productInAction.price <= price.min_price) {
                    removeList.push(price);
                    continue;
                }
                // если product_id может быть добавлен и price.min_price <=❗️ список_кандидатов.max_action_price
                // то вносим в список на добавление
                const productCanPromoted = productsCanPromoted.find((p) => p.id === price.product_id);
                if (productCanPromoted && productCanPromoted.max_action_price >= price.min_price) {
                    price.price = productCanPromoted.max_action_price; // ❗️ для добавления в акцию (activateActionProducts)
                    addList.push(price);
                }
            }
            const resultItem: AddRemoveProductToAction = {
                action_id: action.id,
                removed: {
                    success_ids: [],
                    failed: [],
                },
                added: {
                    success_ids: [],
                    failed: [],
                },
            };
            // удаляем если есть что
            if (removeList.length) {
                const params: DeactivateActionProductsParamsDto = {
                    action_id: action.id,
                    product_ids: removeList.map((p) => p.product_id),
                };
                const removed = await this.deactivateActionProducts(params);
                resultItem.removed.success_ids = removed.product_ids;
                resultItem.removed.failed = removed.rejected;
            }
            // добавляем если есть что
            if (addList.length) {
                const params: ActivateActionProductsParamsDto = {
                    action_id: action.id,
                    products: addList.map(
                        (p) =>
                            <ActivateActionProduct>{
                                product_id: p.product_id,
                                action_price: p.price,
                                stock: p.fboCount + p.fbsCount,
                            },
                    ), // ❗️ используем price.price = productCanPromoted.max_action_price (см выше)
                };
                const added = await this.activateActionProducts(params);
                resultItem.removed.success_ids = added.product_ids;
                resultItem.removed.failed = added.rejected;
            }
            result.push(resultItem);
        }
        return result;
    }
}
