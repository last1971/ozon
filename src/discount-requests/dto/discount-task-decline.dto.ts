export class DiscountTaskDeclineDto {
  tasks: {
    id: number;
    seller_comment?: string;
  }[];
}

export class DiscountTaskDeclineResultDto {
  fail_details: {
    task_id: number;
    error_for_user: string;
  }[];
  success_count: number;
  fail_count: number;
} 