import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import Excel from 'exceljs';

@Injectable()
export class ExportUnprofitableXlsxCommand implements ICommandAsync<IGoodsProcessingContext> {
    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const items = context.unprofitableItems || [];
        context.logger?.log(`Экспорт ${items.length} убыточных товаров в xlsx`);

        const workbook = new Excel.Workbook();
        const sheet = workbook.addWorksheet('Убыточные товары');

        sheet.columns = [
            { header: 'Артикул', key: 'offer_id', width: 15 },
            { header: 'Название', key: 'name', width: 50 },
            { header: 'Входная цена', key: 'incoming_price', width: 15 },
            { header: 'Цена продажи', key: 'selling_price', width: 15 },
            { header: 'Убыток', key: 'loss', width: 15 },
        ];

        for (const item of items) {
            sheet.addRow({
                offer_id: item.offer_id,
                name: item.name,
                incoming_price: Math.round(item.incoming_price * 100) / 100,
                selling_price: Math.round(item.selling_price * 100) / 100,
                loss: Math.round(item.loss * 100) / 100,
            });
        }

        context.xlsxBuffer = await workbook.xlsx.writeBuffer() as Excel.Buffer;
        context.logger?.log('xlsx файл сформирован');

        return context;
    }
}
