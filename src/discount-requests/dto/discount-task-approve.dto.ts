export class DiscountTaskApproveDto {
  tasks: {
    id: number;
    approved_price: number;
    seller_comment?: string;
    approved_quantity_min: number;
    approved_quantity_max: number;
  }[];
}

export class DiscountTaskApproveResultDto {
  fail_details: {
    task_id: number;
    error_for_user: string;
  }[];
  success_count: number;
  fail_count: number;
} 