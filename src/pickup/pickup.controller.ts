import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, Res } from "@nestjs/common";
import { Response } from "express";
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { IInvoice, INVOICE_SERVICE } from "../interfaces/IInvoice";
import { RemarkDto } from "../invoice/dto/remark.dto";
import { InvoiceUpdateDto } from "../invoice/dto/invoice.update.dto";
import { MarkScanFbsService } from "../invoice/mark-scan-fbs.service";
import { OrderService } from "../order/order.service";

@ApiTags("pickup")
@Controller('pickup')
export class PickupController {
    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private markScanService: MarkScanFbsService,
        private orderService: OrderService,
    ) {}

    @Post(':remark/pick')
    @ApiOperation({ summary: 'Подобрать счёт (pickupInvoice). Без передачи в Озон.' })
    @ApiParam({ name: 'remark', description: 'Примечание = номер заказа', type: 'string' })
    @ApiOkResponse({ description: 'Результат подбора: { isSuccess }' })
    async pick(@Param() remarkDto: RemarkDto): Promise<any> {
        const { invoice, match } = remarkDto;
        // Гейт: отменённый счёт подбирать нельзя — иначе кладовщик отгрузит отменённый заказ.
        await this.markScanService.assertLive(match);
        const ready = await this.markScanService.isReadyToFinish(invoice);
        if (!ready) {
            throw new BadRequestException('Не все КМ отсканированы');
        }
        await this.invoiceService.pickupInvoice(invoice, null);
        // Честный ответ вместо всегдашнего { isSuccess: true }: экран должен видеть,
        // подобрался счёт на самом деле или подбор молча не сработал.
        const after = await this.invoiceService.findByPosting(invoice.remark, null);
        const picked = await this.invoiceService.isPickedUp(after?.invoice ?? invoice, null);
        return { isSuccess: picked, status: after?.invoice?.status ?? invoice.status, picked };
    }

    @Post(':remark/marks/prepare')
    @ApiOperation({ summary: 'Фаза 1: предпроверка перед передачей (Озон create-or-get). Ошибка → стоп до диалога.' })
    @ApiParam({ name: 'remark', description: 'Примечание = номер заказа', type: 'string' })
    @ApiOkResponse({ description: 'Результат предпроверки: { prepare }' })
    async prepareMarks(@Param() remarkDto: RemarkDto): Promise<any> {
        const { invoice, match } = remarkDto;
        await this.markScanService.assertLive(match);
        const prepare = await this.orderService.prepareFbsMarksForInvoice(invoice);
        return { prepare };
    }

    @Post(':remark/marks')
    @ApiOperation({ summary: 'Передать КМ (+ГТД) маркетплейсу. Без сборки/ship.' })
    @ApiParam({ name: 'remark', description: 'Примечание = номер заказа', type: 'string' })
    @ApiOkResponse({ description: 'Результат передачи КМ: { submit }' })
    async submitMarks(@Param() remarkDto: RemarkDto): Promise<any> {
        const { invoice, match } = remarkDto;
        await this.markScanService.assertLive(match);
        const ready = await this.markScanService.isReadyToFinish(invoice);
        if (!ready) {
            throw new BadRequestException('Не все КМ отсканированы');
        }
        const submit = await this.orderService.submitFbsMarkCodesForInvoice(invoice);
        return { submit };
    }

    @Get(':remark/label')
    @ApiOperation({ summary: 'Этикетка отправления (стр.1 — ШК). Открывается в новой вкладке для печати.' })
    @ApiParam({ name: 'remark', description: 'Примечание = номер заказа', type: 'string' })
    @ApiResponse({
        status: 200,
        description: 'PDF этикетки отправления',
        content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
    })
    async label(@Param() remarkDto: RemarkDto, @Res() res: Response): Promise<void> {
        const { invoice } = remarkDto;
        const pdf = await this.orderService.getShipmentLabelForInvoice(invoice);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=${invoice.remark}.pdf`);
        res.send(pdf);
    }

    @Put(':remark')
    @ApiParam({
        name: 'remark',
        description: 'Примечание = номер заказа',
        type: 'string',
    })
    @ApiBody({
        description: 'Данные сборки: START_PICKUP / FINISH_PICKUP / IGK',
        type: InvoiceUpdateDto,
    })
    @ApiOkResponse({
        description: 'Результат обновления счёта',
    })
    async update(@Param() remarkDto: RemarkDto, @Body() invoiceUpdateDto: InvoiceUpdateDto): Promise<any> {
        const { invoice, match } = remarkDto;
        if (invoiceUpdateDto.FINISH_PICKUP) {
            await this.markScanService.assertLive(match);
            const ready = await this.markScanService.isReadyToFinish(invoice);
            if (!ready) {
                throw new BadRequestException('Не все КМ отсканированы');
            }
            // Сверка IGK==ШК: отсканированный ШК посылки должен совпасть с эталоном маркетплейса.
            // У ВБ метода нет → expected undefined → сверка пропускается.
            const expected = await this.orderService.getShipmentBarcodeForInvoice(invoice);
            if (expected && invoiceUpdateDto.IGK && invoiceUpdateDto.IGK !== expected) {
                throw new BadRequestException(
                    `Отсканирован не тот ШК: ожидался ${expected}, получен ${invoiceUpdateDto.IGK}`,
                );
            }
        }
        // FINISH_PICKUP только фиксирует IGK и время. Передача КМ — отдельный POST /marks.
        const isSuccess = await this.invoiceService.update(invoice, invoiceUpdateDto);
        return { isSuccess, invoice };
    }
}
