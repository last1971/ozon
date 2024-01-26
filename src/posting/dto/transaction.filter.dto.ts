import { ApiProperty } from '@nestjs/swagger';

export class TransactionFilterDate {
    @ApiProperty({ required: true, type: Date })
    from: Date;
    @ApiProperty({ required: true, type: Date })
    to: Date;
}

export class TransactionFilterDto {
    @ApiProperty({ required: true, type: () => TransactionFilterDate })
    date: TransactionFilterDate;
    @ApiProperty({ required: true })
    transaction_type: string;
}
