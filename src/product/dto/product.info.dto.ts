import { ApiProperty } from '@nestjs/swagger';
import { GoodServiceEnum } from '../../good/good.service.enum';

export class ProductInfoDto {
    @ApiProperty({ description: 'SKU товара', example: 'SKU12345' })
    sku: string;

    @ApiProperty({ description: 'Штрих-код товара', example: '1234567890123' })
    barCode: string;

    @ApiProperty({ description: 'Название или комментарий', example: 'Этот товар популярный' })
    remark: string;

    @ApiProperty({ description: 'Основное изображение товара', example: 'https://example.com/image.jpg', required: false })
    primaryImage?: string;

    @ApiProperty({ description: 'ID товара', example: '12345' })
    id: string;

    @ApiProperty({ description: 'Остаток FBS', type: Number, example: 100 })
    fbsCount: number;

    @ApiProperty({ description: 'Остаток FBO', type: Number, example: 100 })
    fboCount: number;

    @ApiProperty({ description: 'Сервис товара', enum: GoodServiceEnum })
    goodService: GoodServiceEnum;

    @ApiProperty({ description: 'ID типа товара', example: 970707376, required: false })
    typeId?: number;
}
