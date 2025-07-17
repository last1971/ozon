export class DiscountTaskListDto {
  result: DiscountTaskDto[];
}

export class DiscountTaskDto {
  id: number;
  created_at: string;
  end_at: string;
  edited_till: string;
  status: string;
  customer_name: string;
  sku: number;
  user_comment: string;
  seller_comment: string;
  requested_price: number;
  approved_price: number;
  original_price: number;
  discount: number;
  discount_percent: number;
  base_price: number;
  min_auto_price: number;
  prev_task_id: number;
  is_damaged: boolean;
  moderated_at: string;
  approved_discount: number;
  approved_discount_percent: number;
  is_purchased: boolean;
  is_auto_moderated: boolean;
  offer_id: string;
  email: string;
  last_name: string;
  first_name: string;
  patronymic: string;
  approved_quantity_min: number;
  approved_quantity_max: number;
  requested_quantity_min: number;
  requested_quantity_max: number;
  requested_price_with_fee: number;
  approved_price_with_fee: number;
  approved_price_fee_percent: number;
} 