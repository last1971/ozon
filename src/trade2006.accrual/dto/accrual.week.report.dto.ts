import { ApiProperty } from '@nestjs/swagger';

export class AccrualBucketDto {
    @ApiProperty({ description: 'Сколько записей журнала' })
    count: number;
    @ApiProperty({ description: 'На какую сумму, рубли' })
    amount: number;
}

export class AccrualUnpaidDto {
    @ApiProperty({ description: 'Номер отправления' })
    postingNumber: string;
    @ApiProperty({ description: 'Сумма, которая должна была уйти в счёт' })
    amount: number;
    @ApiProperty({ description: 'Почему не оплачено' })
    reason: string;
}

/** Итог прогона недели: три списка, по которым видно, что произошло с деньгами. */
export class AccrualWeekReportDto {
    @ApiProperty({ description: 'Период прогона' })
    period: { from: string; to: string };

    @ApiProperty({ description: 'Сколько начислений загружено в журнал за период' })
    loaded: number;

    @ApiProperty({
        description: 'Дни за последние 60 суток, которых нет в реестре. Дырка молча съедает эквайринг',
        type: [String],
    })
    missingDays: string[];

    @ApiProperty({ description: 'Счета закрыты' })
    closed: AccrualBucketDto;

    @ApiProperty({ description: 'Разобраться руками: счёт не найден или не готов к оплате', type: [AccrualUnpaidDto] })
    unpaid: AccrualUnpaidDto[];

    @ApiProperty({ description: 'Ждут своего тела в журнале — нормальное состояние' })
    waiting: AccrualBucketDto;

    @ApiProperty({ description: 'Опоздали: счёт уже оплачен и закрыт либо счёта нет' })
    late: AccrualBucketDto;

    @ApiProperty({
        description: 'Возвраты и невыкупы — считаются отдельно. Сторно плюс ожидавшие, чей счёт отменён',
    })
    returns: AccrualBucketDto;

    @ApiProperty({ description: 'В письмо: реклама, складские и страховые услуги без привязки' })
    letter: AccrualBucketDto;

    @ApiProperty({ description: 'Контроль: загруженное за период равно сумме всех корзин' })
    balanced: boolean;
}
