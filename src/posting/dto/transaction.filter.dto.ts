export class TransactionFilterDto {
    date: {
        from: Date;
        to: Date;
    };
    transaction_type: string;
}
