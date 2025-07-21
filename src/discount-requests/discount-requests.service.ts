import { Injectable } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { DiscountTaskListParamsDto } from './dto/discount-task-list-params.dto';
import { DiscountTaskListDto } from './dto/discount-task-list.dto';
import { DiscountTaskApproveDto, DiscountTaskApproveResultDto } from './dto/discount-task-approve.dto';
import { DiscountTaskDeclineDto, DiscountTaskDeclineResultDto } from './dto/discount-task-decline.dto';
import { DiscountTaskStatus } from './dto/discount-task-status.enum';
import { DiscountTaskDto } from './dto/discount-task-list.dto';
import { ExtraPriceService } from '../price/extra.price.service';
import { PriceService } from '../price/price.service';
import { ProductVisibility } from '../product/product.visibility';

interface ProcessingResult {
    approved: number;
    declined: number;
    errors: string[];
}

interface ProcessedData {
    tasks: DiscountTaskDto[];
    pricesMap: Map<string, any>;
}

interface Decisions {
    approveTasks: {
        id: string;
        approved_price: number;
        seller_comment?: string;
        approved_quantity_min: number;
        approved_quantity_max: number;
    }[];
    declineTasks: {
        id: string;
        seller_comment?: string;
    }[];
}

@Injectable()
export class DiscountRequestsService {
    constructor(
        private ozonApiService: OzonApiService,
        private extraPriceService: ExtraPriceService,
        private priceService: PriceService
    ) {}

    async getDiscountTasks(params: DiscountTaskListParamsDto): Promise<DiscountTaskListDto> {
        return this.ozonApiService.rawFetch('/v1/actions/discounts-task/list', params);
    }

    async approveDiscountTask(params: DiscountTaskApproveDto): Promise<DiscountTaskApproveResultDto> {
        return this.ozonApiService.method('/v1/actions/discounts-task/approve', params, 'post');
    }

    async declineDiscountTask(params: DiscountTaskDeclineDto): Promise<DiscountTaskDeclineResultDto> {
        return this.ozonApiService.method('/v1/actions/discounts-task/decline', params, 'post');
    }

    async getAllUnprocessedDiscountTasks(): Promise<DiscountTaskDto[]> {
        let allTasks: DiscountTaskDto[] = [];
        let page = 1; // Ozon API требует page > 0
        let hasMore = true;
        
        while (hasMore) {
            const params: DiscountTaskListParamsDto = {
                status: DiscountTaskStatus.NEW,
                page: page,
                limit: 50 // Максимальное допустимое значение для Ozon API
            };
            
            const response = await this.getDiscountTasks(params);
            
            // Проверяем, что response и response.result существуют
            if (!response || !response.result) {
                break;
            }
            
            allTasks = allTasks.concat(response.result);
            
            // Если получили меньше 50 записей, значит это последняя страница
            hasMore = response.result.length === 50;
            page++;
        }
        
        return allTasks;
    }

    /**
     * Автоматическая обработка заявок на скидку
     */
    async autoProcessDiscountRequests(): Promise<ProcessingResult> {
        const errors: string[] = [];
        let approved = 0;
        let declined = 0;

        try {
            // 1. Получаем и обрабатываем данные
            const processedData = await this.processIncomingGoods();
            
            if (processedData.tasks.length === 0) {
                return { approved: 0, declined: 0, errors: [] };
            }

            // 2. Принимаем решения
            const decisions = this.makeDecisions(processedData, errors);

            // 3. Выполняем решения
            const results = await this.executeDecisions(decisions, errors);
            approved = results.approved;
            declined = results.declined;

        } catch (error) {
            errors.push(`Общая ошибка обработки: ${error.message}`);
        }

        return { approved, declined, errors };
    }

    /**
     * Получает новые заявки и обрабатывает входящие товары
     */
    private async processIncomingGoods(): Promise<ProcessedData> {
        // Получаем новые заявки
        const tasks = await this.getAllUnprocessedDiscountTasks();
        
        // Маппим offer_id (обрезаем хвосты)
        const originalOfferIds = this.extractOriginalOfferIds(tasks);
        
        // Обрабатываем входящие товары
        await this.extraPriceService.handleIncomingGoods(originalOfferIds);
        
        // Получаем цены
        const pricesMap = await this.getPricesMap(tasks.map(task => task.offer_id));
        
        return { tasks, pricesMap };
    }

    /**
     * Извлекает оригинальные offer_id из заявок
     */
    private extractOriginalOfferIds(tasks: DiscountTaskDto[]): string[] {
        const originalOfferIds = tasks.map(task => {
            const offerId = task.offer_id;
            return offerId.includes('-') ? offerId.split('-')[0] : offerId;
        });
        
        // Убираем дубли
        return [...new Set(originalOfferIds)];
    }

    /**
     * Получает карту цен для offer_id
     */
    private async getPricesMap(offerIds: string[]): Promise<Map<string, any>> {
        const pricesResponse = await this.priceService.index({
            offer_id: offerIds,
            limit: 1000,
            visibility: ProductVisibility.ALL
        });

        const pricesMap = new Map();
        pricesResponse.data.forEach(item => {
            pricesMap.set(item.offer_id, item);
        });
        
        return pricesMap;
    }

    /**
     * Принимает решения об апруве/деклайне заявок
     */
    private makeDecisions(processedData: ProcessedData, errors: string[]): Decisions {
        const approveTasks: Decisions['approveTasks'] = [];
        const declineTasks: Decisions['declineTasks'] = [];

        for (const task of processedData.tasks) {
            try {
                const decision = this.makeDecisionForTask(task, processedData.pricesMap);
                
                if (decision.type === 'approve') {
                    approveTasks.push(decision.data);
                } else {
                    declineTasks.push(decision.data);
                }
            } catch (error) {
                errors.push(`Ошибка обработки заявки ${task.id}: ${error.message}`);
            }
        }

        return { approveTasks, declineTasks };
    }

    /**
     * Принимает решение для одной заявки
     */
    private makeDecisionForTask(task: DiscountTaskDto, pricesMap: Map<string, any>): 
        { type: 'approve'; data: Decisions['approveTasks'][0] } | 
        { type: 'decline'; data: Decisions['declineTasks'][0] } {
        
        const priceData = pricesMap.get(task.offer_id);
        
        if (!priceData) {
            throw new Error(`Не найдены цены для offer_id: ${task.offer_id}`);
        }

        const minPrice = parseFloat(priceData.min_price);
        const requestedPrice = task.requested_price;

        if (requestedPrice >= minPrice) {
            return {
                type: 'approve',
                data: {
                    id: task.id,
                    approved_price: minPrice,
                    seller_comment: '',
                    approved_quantity_min: task.requested_quantity_min,
                    approved_quantity_max: task.requested_quantity_max
                }
            };
        } else {
            return {
                type: 'decline',
                data: {
                    id: task.id,
                    seller_comment: ''
                }
            };
        }
    }

    /**
     * Выполняет решения (апрув/деклайн)
     */
    private async executeDecisions(decisions: Decisions, errors: string[]): Promise<{ approved: number; declined: number }> {
        let approved = 0;
        let declined = 0;

        // Апрувим заявки
        if (decisions.approveTasks.length > 0) {
            try {
                const hz = await this.approveDiscountTask({ tasks: decisions.approveTasks });
                approved = decisions.approveTasks.length;
            } catch (error) {
                errors.push(`Ошибка при апруве заявок: ${error.message}`);
            }
        }

        // Деклайним заявки
        if (decisions.declineTasks.length > 0) {
            try {
                const hz = await this.declineDiscountTask({ tasks: decisions.declineTasks });
                declined = decisions.declineTasks.length;
            } catch (error) {
                errors.push(`Ошибка при реджекте заявок: ${error.message}`);
            }
        }

        return { approved, declined };
    }
} 