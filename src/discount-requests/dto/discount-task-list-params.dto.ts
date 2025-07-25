import { DiscountTaskStatus } from './discount-task-status.enum';

export class DiscountTaskListParamsDto {
  status: DiscountTaskStatus; // required
  page?: number;
  limit: number; // required
} 