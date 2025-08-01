import { Expose, Exclude } from 'class-transformer';

@Exclude()
export class TransferOutDTO {
    @Expose({ name: 'SFCODE' })
    id: number;

    @Expose({ name: 'POKUPATCODE' })
    buyerId: number;

    @Expose({ name: 'NSF' })
    number: string;

    @Expose({ name: 'DATA' })
    date: Date;

    @Expose({ name: 'SCODE' })
    invoiceId: number;
} 