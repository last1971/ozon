import { ApiProperty } from '@nestjs/swagger';

export class DiscountTaskApproveDto {
  tasks: {
    id: string;
    approved_price: number;
    seller_comment?: string;
    approved_quantity_min: number;
    approved_quantity_max: number;
  }[];
}

export class DiscountTaskApproveItemDto {
    @ApiProperty({ description: 'ID заявки', type: String })
    id: string;
    approved_price: number;
    seller_comment?: string;
    approved_quantity_min: number;
    approved_quantity_max: number;
}

export class DiscountTaskApproveResultDto {
  fail_details: {
    task_id: string;
    error_for_user: string;
  }[];
  success_count: number;
  fail_count: number;
}

export class DiscountTaskApproveFailDetailDto {
    @ApiProperty({ description: 'ID заявки', type: String })
    task_id: string;
    error_for_user: string;
} 