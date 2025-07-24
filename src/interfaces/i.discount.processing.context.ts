import { DiscountTaskDto } from '../discount-requests/dto/discount-task-list.dto';
import { Logger } from '@nestjs/common';

export interface IDiscountDecisions {
    approveTasks: {
        id: string;
        approved_price: number;
        seller_comment?: string;
        approved_quantity_min: number;
        approved_quantity_max: number;
    }[];
    declineTasks: {
        id: string;
        seller_comment?: string;
    }[];
}

export interface IDiscountProcessingContext {
    tasks?: DiscountTaskDto[];
    threshold?: number;
    stopChain?: boolean;
    errors?: string[];
    approved?: number;
    declined?: number;
    logger?: { log: (msg: string) => void };
    decisions?: IDiscountDecisions;
    originalOfferIds?: string[];
    pricesMap?: Map<string, any>;
}
