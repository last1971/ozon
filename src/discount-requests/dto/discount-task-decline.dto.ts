import { ApiProperty } from '@nestjs/swagger';

export class DiscountTaskDeclineDto {
  tasks: {
    id: string;
    seller_comment?: string;
  }[];
}

export class DiscountTaskDeclineItemDto {
    @ApiProperty({ description: 'ID заявки', type: String })
    id: string;
}

export class DiscountTaskDeclineResultDto {
  fail_details: {
    task_id: string;
    error_for_user: string;
  }[];
  success_count: number;
  fail_count: number;
}

export class DiscountTaskDeclineFailDetailDto {
    @ApiProperty({ description: 'ID заявки', type: String })
    task_id: string;
} 