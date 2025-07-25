import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DiscountRequestsService } from './discount-requests.service';
import { DiscountTaskDto } from './dto/discount-task-list.dto';

@ApiTags('discount-requests')
@Controller('discount-requests')
export class DiscountRequestsController {
    constructor(private readonly discountRequestsService: DiscountRequestsService) {}

    @Get('unprocessed')
    @ApiOperation({ 
        summary: 'Получить все необработанные заявки на скидку',
        description: 'Возвращает все заявки на скидку со статусом NEW'
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Список всех необработанных заявок на скидку',
        type: [DiscountTaskDto]
    })
    async getAllUnprocessedDiscountTasks(): Promise<DiscountTaskDto[]> {
        return this.discountRequestsService.getAllUnprocessedDiscountTasks();
    }

    @Post('auto-process')
    @ApiOperation({ 
        summary: 'Автоматическая обработка заявок на скидку',
        description: 'Получает новые заявки, обрабатывает входящие товары, получает цены и принимает решение об апруве/деклайне'
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Результат автоматической обработки заявок',
        schema: {
            type: 'object',
            properties: {
                approved: { type: 'number', description: 'Количество одобренных заявок' },
                declined: { type: 'number', description: 'Количество отклоненных заявок' },
                errors: { 
                    type: 'array', 
                    items: { type: 'string' },
                    description: 'Список ошибок при обработке'
                }
            }
        }
    })
    async autoProcessDiscountRequests(): Promise<{
        approved: number;
        declined: number;
        errors: string[];
    }> {
        return this.discountRequestsService.autoProcessDiscountRequests();
    }
} 