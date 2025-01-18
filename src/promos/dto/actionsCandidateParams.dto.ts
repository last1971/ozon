import { ApiProperty } from '@nestjs/swagger';

export class ActionsListParamsDto {
    @ApiProperty({ description: 'Идентификатор акции' })
    action_id: number;

    @ApiProperty({ description: 'Количество ответов на странице. По умолчанию — 100.' })
    limit: number;

    @ApiProperty({
        description:
            'Количество элементов, которое будет пропущено в ответе. Например, если offset=10, ответ начнётся с 11-го найденного элемента.',
    })
    offset: number;
}
