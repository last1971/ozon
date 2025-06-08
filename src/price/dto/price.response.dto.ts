import { PriceDto } from './price.dto';
import { ApiProperty } from '@nestjs/swagger';

export class PriceResponseDto {
    @ApiProperty({ description: 'Массив цен от Озон', isArray: true, type: PriceDto })
    data: PriceDto[];
    @ApiProperty({
        description:
            'Идентификатор последнего значения на странице. Оставьте это поле пустым при выполнении первого запроса.\n' +
            '\n' +
            'Чтобы получить следующие значения, укажите last_id из ответа предыдущего запроса.',
    })
        // в оригинальном методе Озон заменено на cursor. Тут пока не стал трогать
    last_id: string;
}
