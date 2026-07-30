import { ProductPostingDto } from '../../product/dto/product.posting.dto';
import { ApiProperty } from "@nestjs/swagger";
import { GoodServiceEnum } from "../../good/good.service.enum";

export class PostingDto {
    @ApiProperty({ description: 'Номер отправления' })
    posting_number: string;

    @ApiProperty({ description: 'Статус отправления' })
    status: string;

    @ApiProperty({ description: 'Дата' })
    in_process_at: string;

    @ApiProperty({ type: () => [ProductPostingDto], description: 'Список продуктов' })
    products: ProductPostingDto[];

    @ApiProperty({ description: 'Данные аналитики', required: false })
    analytics_data?: {
        warehouse_name: string;
    };

    @ApiProperty({ description: 'Финансовые данные', required: false })
    financial_data?: {
        cluster_from?: string;
        cluster_to?: string;
    };

    @ApiProperty({ description: 'Флаг FBO', required: false })
    isFbo?: boolean;

    @ApiProperty({ description: 'Маркетплейс (WB/OZON/YANDEX) — фронт ветвит флоу по нему', required: false, enum: GoodServiceEnum })
    service?: GoodServiceEnum;
}
