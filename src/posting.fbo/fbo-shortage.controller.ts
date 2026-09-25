import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { FboShortageRowDto } from '../invoice/dto/invoice-donors.dto';
import { DonorApplyService } from './donor-apply.service';
import { FboShortageApplyDto, FboShortageApplyResultDto } from './dto/fbo-shortage-apply.dto';

@ApiTags('fbo-shortage')
@Controller('fbo-shortage')
export class FboShortageController {
    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly applyService: DonorApplyService,
    ) {}

    @Get()
    @ApiOperation({ summary: 'Открытые недоборы FBO (журнал FBO_SHORTAGE), свежие сверху' })
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
}
