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
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { GetDiscountTasksCommand } from './commands/get-discount-tasks.command';
import { ExtractOriginalOfferIdsCommand } from './commands/extract-original-offer-ids.command';
import { HandleDiscountsCommand } from './commands/handle-discounts.command';
import { GetPricesMapCommand } from './commands/get-prices-map.command';
import { MakeDecisionsCommand } from './commands/make-decisions.command';
import { ApproveDiscountTasksCommand } from './commands/approve-discount-tasks.command';
import { DeclineDiscountTasksCommand } from './commands/decline-discount-tasks.command';

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
        private priceService: PriceService,
        private readonly getDiscountTasksCommand: GetDiscountTasksCommand,
        private readonly extractOriginalOfferIdsCommand: ExtractOriginalOfferIdsCommand,
        private readonly handleDiscountsCommand: HandleDiscountsCommand,
        private readonly getPricesMapCommand: GetPricesMapCommand,
        private readonly makeDecisionsCommand: MakeDecisionsCommand,
        private readonly approveDiscountTasksCommand: ApproveDiscountTasksCommand,
        private readonly declineDiscountTasksCommand: DeclineDiscountTasksCommand,
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
        const context = {
            errors: [],
            approved: 0,
            declined: 0,
        };

        const chain = new CommandChainAsync([
            this.getDiscountTasksCommand,
            this.extractOriginalOfferIdsCommand,
            this.handleDiscountsCommand,
            this.getPricesMapCommand,
            this.makeDecisionsCommand,
            this.approveDiscountTasksCommand,
            this.declineDiscountTasksCommand,
        ]);

        const resultContext = await chain.execute(context);

        return {
            approved: resultContext.approved ?? 0,
            declined: resultContext.declined ?? 0,
            errors: resultContext.errors ?? [],
        };
    }
} 