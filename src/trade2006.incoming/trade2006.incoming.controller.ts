import { Controller, Post } from '@nestjs/common';
import { Trade2006IncomingService } from './trade2006.incoming.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('trade2006-incoming')
@Controller('trade2006/incoming')
export class Trade2006IncomingController {
    constructor(private readonly trade2006IncomingService: Trade2006IncomingService) {}

    @Post('check')
    @ApiOperation({ summary: 'Разобрать очередь приходов сейчас, не дожидаясь тишины и крона' })
    @ApiResponse({ status: 200, description: 'Очередь разобрана' })
    async manualCheck(): Promise<{ success: boolean; message: string }> {
        const ctx = await this.trade2006IncomingService.manualCheck();
        if (!ctx) return { success: false, message: 'Проход уже идёт или упал — см. лог' };
        return {
            success: true,
            message: `Приходов: ${ctx.prihods.length}, товаров: ${ctx.skus.length}`,
        };
    }
}
