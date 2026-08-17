export class ReturnDto {
    /** Ozon — числовой id возврата, ВБ — UUID заявки. В журнал уходит строкой. */
    id: number | string;
    posting_number: string;
    schema: 'Fbs' | 'Fbo';
    order_number: string;
    logistic?: {
        return_date?: string;
    };
    visual?: {
        status?: {
            id: number;
            sys_name: string;
            display_name: string;
        };
    };
}
