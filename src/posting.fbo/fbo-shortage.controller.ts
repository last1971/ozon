import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { FboShortageRowDto } from '../invoice/dto/invoice-donors.dto';
import { DonorApplyService } from './donor-apply.service';
import { FboShortageApplyDto, FboShortageApplyResultDto } from './dto/fbo-shortage-apply.dto';
import { FboShortagePeresortDto, FboShortagePeresortResultDto } from './dto/fbo-shortage-peresort.dto';
import { PeresortService } from './peresort.service';

@ApiTags('fbo-shortage')
@Controller('fbo-shortage')
export class FboShortageController {
    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly applyService: DonorApplyService,
        private readonly peresortService: PeresortService,
    ) {}

    @Get()
    @ApiOperation({
        summary: 'Открытые недоборы FBO, свежие сверху',
        description:
            'Журнал FBO_SHORTAGE даёт кандидатов; открыт недобор или нет, решает счёт: он в подборке (STATUS=3) ' +
            'и по строке товара подобрано меньше, чем нужно. Закрытое руками в Delphi сюда не попадает.',
    })
    @ApiOkResponse({ type: [FboShortageRowDto] })
    list(): Promise<FboShortageRowDto[]> {
        return this.invoiceService.listFboShortages();
    }

    @Post(':posting/apply')
    @ApiOperation({
        summary: 'Закрыть недобор руками: перенести с выбранных доноров на строки счёта',
        description:
            'Предложение — GET /api/invoice/donors/:posting. По каждой тронутой строке сумма «взять» должна равняться ' +
            'недобору ровно, с донора не больше подобранного, кратно фасовке. Коды маркировки едут вместе с товаром. ' +
            'Всё или ничего в одной транзакции; недобор закрывается в журнале, счёт уходит в подбор, как у автоматики.',
    })
    @ApiParam({ name: 'posting', type: 'string', description: 'Номер отправления — как в журнале недобора' })
    @ApiBody({ type: FboShortageApplyDto })
    @ApiOkResponse({ type: FboShortageApplyResultDto })
    apply(@Param('posting') posting: string, @Body() body: FboShortageApplyDto): Promise<FboShortageApplyResultDto> {
        return this.applyService.apply(posting, body);
    }

    @Post(':posting/peresort')
    @ApiOperation({
        summary: 'Закрыть недобор пересортицей: оприходовать недостающее (списание с минусом) и подобрать в счёт',
        description:
            'Для строки без доноров. Сперва пересортица на весь недобор строки, потом подбор — одной транзакцией. ' +
            'Маркируемому товару недоступно. Недобор закрывается в журнале, счёт уходит в подбор, как у переноса с доноров.',
    })
    @ApiParam({ name: 'posting', type: 'string', description: 'Номер отправления — как в журнале недобора' })
    @ApiBody({ type: FboShortagePeresortDto })
    @ApiOkResponse({ type: FboShortagePeresortResultDto })
    peresort(
        @Param('posting') posting: string,
        @Body() body: FboShortagePeresortDto,
    ): Promise<FboShortagePeresortResultDto> {
        return this.peresortService.apply(posting, body);
    }
}
