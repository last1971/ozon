import { Injectable } from '@nestjs/common';
import { WbApiService } from '../wb.api/wb.api.service';
import { RateLimit } from '../helpers/decorators/rate-limit.decorator';
import { WbClaimQueryDto } from './dto/wb.claim.query.dto';
import { WbClaimsResponseDto } from './dto/wb.claim.dto';

@Injectable()
export class WbCustomerService {
    constructor(private wbApi: WbApiService) {}

    /**
     * Получить заявки покупателей на возврат
     * Rate limit: 3 запроса в секунду (333ms между запросами)
     * @param query - Параметры запроса
     * @returns Список заявок на возврат
     */
    @RateLimit(333)
    async getClaims(query: WbClaimQueryDto): Promise<WbClaimsResponseDto> {
        return this.wbApi.method(
            'https://feedbacks-api.wildberries.ru/api/v1/claims',
            'get',
            query,
            true, // fullName = true, используем полный URL
        );
    }
}
