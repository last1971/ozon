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
import { PriceService } from '../price/price.service';
import { PriceResponseDto } from '../price/dto/price.response.dto';
import { PriceDto } from 'src/price/dto/price.dto';
import { chunk as chunkArray } from 'lodash';
import { OnEvent } from '@nestjs/event-emitter';

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
 * Сервис, отвечающий за обработку промо-акций.
 *
 * @class PromosService
 */
@Injectable()
/**
 * Сервис для работы с промо-акциями.
 */
export class PromosService {
    /**
     * Создаёт экземпляр PromosService.
     *
     * @param {OzonApiService} ozonApiService - Сервис Ozon API.
     * @param productService - Сервис работы с товарами.
     */
    constructor(
        private ozonApiService: OzonApiService,
        private productService: ProductService,
        private priceService: PriceService,
    ) {}

    /**
     * Получает список акций.
     *
     * @returns {Promise<ActionsDto>} Промис, который возвращает список акций.
     */
    async getActions(): Promise<ActionsDto[]> {
        const res = await this.ozonApiService.method('/v1/actions', {}, 'get');
        return res.result;
    }

    /**
     * Получает список кандидатов на участие в акции на основе предоставленных параметров.
     *
     * @param {ActionsListParamsDto} params - Параметры для получения кандидатов на акцию.
     * @returns {Promise<ActionsListDto>} Промис, который возвращает список кандидатов на акцию.
     */
    async getActionsCandidates(params: ActionsListParamsDto): Promise<ActionsListDto> {
        const res = await this.ozonApiService.method('/v1/actions/candidates', params);
        return res.result;
    }

    /**
     * Получает список товаров, участвующих в акции, на основе предоставленных параметров.
     *
     * @param {ActionsListParamsDto} params - Параметры для получения товаров акции.
     * @returns {Promise<ActionsListDto>} Промис, который возвращает список товаров акции.
     */
    async getActionsProducts(params: ActionsListParamsDto): Promise<ActionsListDto> {
        const res = await this.ozonApiService.method('/v1/actions/products', params);
        return res.result;
    }

    /**
     * Активирует товары акции на основе предоставленных параметров.
     *
     * @param {ActivateActionProductsParamsDto} params - Параметры для активации товаров акции.
     * @returns {Promise<ActivateOrDeactivateActionProductsDto>} Промис, который возвращает результат активации.
     */
    async activateActionProducts(
        params: ActivateActionProductsParamsDto,
    ): Promise<ActivateOrDeactivateActionProductsDto> {
        const res = await this.ozonApiService.method('/v1/actions/products/activate', params);
        return res.result;
    }

    /**
     * Деактивирует товары акции на основе предоставленных параметров.
     *
     * @param {DeactivateActionProductsParamsDto} params - Параметры для деактивации товаров акции.
     * @returns {Promise<ActivateOrDeactivateActionProductsDto>} Промис, который возвращает результат деактивации.
     */
    async deactivateActionProducts(
        params: DeactivateActionProductsParamsDto,
    ): Promise<ActivateOrDeactivateActionProductsDto> {
        const res = await this.ozonApiService.method('/v1/actions/products/deactivate', params);
        return res.result;
    }

    /**
     * Удаляет неподходящие товары из акции на основе их цен.
     *
     * Этот метод получает все товары, связанные с указанной акцией, проверяет их цены
     * и деактивирует те, которые не соответствуют необходимым ценовым критериям.
     *
     * @param {number} actionId - Идентификатор акции, из которой нужно удалить неподходящие товары.
     * @returns {Promise<number>} - Промис, который возвращает количество деактивированных товаров.
     *
     * @throws {Error} - Генерирует ошибку в случае проблем с получением товаров, цен или деактивацией товаров.
     */
    async unfitProductsRemoval(actionId: number): Promise<number> {
        const actionProducts = await this.getAllActionsProductsOrCandidates(actionId, 'products');
        const productsPrice = await this.productService.getProductsPrices(actionProducts);
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
     * Добавляет подходящие товары в акцию на основе выбранной стратегии.
     *
     * Этот метод получает всех кандидатов на участие в акции, проверяет их цены
     * и активирует те товары, которые соответствуют ценовым критериям согласно выбранной стратегии.
     *
     * @param {number} actionId - Идентификатор акции, в которую нужно добавить товары.
     * @param {FitProductsStrategy} strategy - Стратегия, используемая для добавления товаров.
     * @returns {Promise<number>} - Промис, который возвращает количество товаров, добавленных в акцию.
     *
     * @throws {Error} - Генерирует ошибку в случае проблем с получением товаров, цен или активацией товаров.
     */
    async fitProductsAddition(actionId: number, strategy: FitProductsStrategy): Promise<number> {
        const actionCandidates = await this.getAllActionsProductsOrCandidates(actionId, 'candidates');
        const candidatesPrice = await this.productService.getProductsPrices(actionCandidates);
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
     * Получает все товары, связанные с указанной акцией, с поддержкой постраничной выборки.
     *
     * @param {number} actionId - Идентификатор акции, для которой требуется получить товары.
     * @param {'products' | 'candidates'} type - Тип товаров для получения: участвующие в акции или кандидаты.
     * @param {number} [limit=100] - Максимальное количество товаров, обрабатываемых за один запрос.
     * @returns {Promise<ActionListProduct[]>} Промис, который возвращает массив товаров акции.
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

    /**
     * Получает все товары, связанные с указанной акцией, с поддержкой постраничной выборки.
     *
     * @param {number} actionId - Идентификатор акции, для которой требуется получить товары.
     * @param {'products' | 'candidates'} type - Тип товаров для получения: участвующие в акции или кандидаты.
     * @param {number} [limit=100] - Максимальное количество товаров, обрабатываемых за один запрос.
     * @returns {Promise<ActionListProduct[]>} Промис, который возвращает массив товаров акции.
     */
    async getActionListProduct(
        method: (params: ActionsListParamsDto) => Promise<ActionsListDto>,
        actionId: number,
        limit: number = 100,
    ): Promise<ActionListProduct[]> {
        let offset = 0;
        let actionProducts: ActionListProduct[] = [];
        let isMoreDataAvailable = true;

        while (isMoreDataAvailable) {
            const { products } = await method.call(this, { action_id: actionId, limit, offset });
            actionProducts = actionProducts.concat(products);
            offset += limit;

            // Если количество возвращённых продуктов меньше лимита, больше данных нет
            isMoreDataAvailable = products.length === limit;
        }

        return actionProducts;
    }

    /**
     * Добавляет или удаляет товары из промо-акций на основе их текущих цен и условий участия.
     *
     * Этот метод обрабатывает список идентификаторов товаров, проверяет их цены и определяет для каждой акции:
     * - Какие товары следует удалить из акции (если их цена больше не соответствует условиям).
     * - Какие товары можно добавить в акцию (если их цена соответствует критериям).
     *
     * Обработка выполняется чанками, чтобы избежать перегрузки системы большими запросами.
     *
     * @param ids - Массив идентификаторов товаров для обработки.
     * @param chunkLimit - Максимальное количество идентификаторов товаров в одном чанке (по умолчанию 100).
     * @returns Промис, который возвращает массив результатов, каждый из которых описывает результат операций добавления/удаления для каждой акции.
     *
     * @remarks
     * - Товары удаляются из акции, если их текущая цена больше либо равна цене акции.
     * - Товары добавляются в акцию, если их минимальная цена меньше либо равна максимальной цене кандидата на акцию.
     * - Метод собирает и возвращает успешные и неуспешные идентификаторы для операций добавления и удаления по каждой акции.
     */
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

            // используем для кэширования productCanPromoted.max_action_price
            const maxPrices: Record<number, number> = {};

            // для каждого товара из списка прайсов
            for (const price of prices) {
                // если product_id в акции и actionRec.action_price <=❗️ price.min_price
                // то вносим в список на исключение
                const productInAction = productsInAction.find((p) => p.id === price.product_id);
                if (productInAction && productInAction.action_price <= price.min_price) {
                    removeList.push(price);
                    continue;
                }
                // если product_id может быть добавлен и price.min_price <=❗️ список_кандидатов.max_action_price
                // то вносим в список на добавление
                const productCanPromoted = productsCanPromoted.find((p) => p.id === price.product_id);
                if (productCanPromoted && productCanPromoted.max_action_price >= price.min_price) {
                    maxPrices[price.product_id] = productCanPromoted.max_action_price;
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
                                action_price: maxPrices[p.product_id],
                                stock: p.fboCount + p.fbsCount,
                            },
                    ),
                };
                const added = await this.activateActionProducts(params);
                resultItem.added.success_ids = added.product_ids; // Исправлено: было resultItem.removed
                resultItem.added.failed = added.rejected;
            }
            result.push(resultItem);
        }
        return result;
    }

    @OnEvent('update.promos')
    async handleUpdatePromos(skus: string[]): Promise<void> {
        await this.addRemoveProductToActions(skus);
    }
}
