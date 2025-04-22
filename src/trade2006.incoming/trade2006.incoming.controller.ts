import { Controller, Post } from "@nestjs/common";
import { Trade2006IncomingService } from "./trade2006.incoming.service";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("trade2006-incoming")
@Controller("trade2006/incoming")
export class Trade2006IncomingController {
    constructor(private readonly trade2006IncomingService: Trade2006IncomingService) {
    }

    @Post("check")
    @ApiOperation({ summary: "Ручная проверка новых товаров" })
    @ApiResponse({ status: 200, description: "Проверка выполнена успешно" })
    async manualCheck(): Promise<{ success: boolean; message: string }> {
        try {
            await this.trade2006IncomingService.manualCheck();
            return {
                success: true,
                message: "Проверка новых товаров выполнена успешно"
            };
        } catch (error) {
            return {
                success: false,
                message: `Ошибка при проверке новых товаров: ${error.message}`
            };
        }
    }
}