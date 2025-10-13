import { Injectable } from '@nestjs/common';
import { WbApiService } from '../wb.api/wb.api.service';
import { RateLimit } from '../helpers/decorators/rate-limit.decorator';
import { WbClaimQueryDto } from './dto/wb.claim.query.dto';
import { WbClaimDto, WbClaimsResponseDto } from './dto/wb.claim.dto';

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
            'https://returns-api.wildberries.ru/api/v1/claims',
            'get',
            query,
            true, // fullName = true, используем полный URL
        );
    }

    /**
     * Получить претензию по ID
     * Сначала ищет в неархивных, если не найдено - ищет в архивных
     * @param id - UUID претензии
     * @returns Претензия или null если не найдена
     */
    @RateLimit(333)
    async getClaimById(id: string): Promise<WbClaimDto | null> {
        // Ищем сначала в неархивных
        const responseActive = await this.getClaims({ is_archive: false, id });

        if (responseActive.claims && responseActive.claims.length > 0) {
            return responseActive.claims[0];
        }

        // Если не нашли, ищем в архивных
        const responseArchived = await this.getClaims({ is_archive: true, id });

        if (responseArchived.claims && responseArchived.claims.length > 0) {
            return responseArchived.claims[0];
        }

        return null;
    }
}
