import { ApiProperty } from '@nestjs/swagger';

export class DiscountTaskDto {
  @ApiProperty({ description: 'ID заявки на скидку' })
  id: string;

  @ApiProperty({ description: 'Дата создания заявки' })
  created_at: string;

  @ApiProperty({ description: 'Дата окончания заявки' })
  end_at: string;

  @ApiProperty({ description: 'Дата до которой можно редактировать' })
  edited_till: string;

  @ApiProperty({ description: 'Статус заявки' })
  status: string;

  @ApiProperty({ description: 'Имя покупателя' })
  customer_name: string;

  @ApiProperty({ description: 'SKU товара' })
  sku: number;

  @ApiProperty({ description: 'Комментарий пользователя' })
  user_comment: string;

  @ApiProperty({ description: 'Комментарий продавца' })
  seller_comment: string;

  @ApiProperty({ description: 'Запрашиваемая цена' })
  requested_price: number;

  @ApiProperty({ description: 'Одобренная цена' })
  approved_price: number;

  @ApiProperty({ description: 'Оригинальная цена' })
  original_price: number;

  @ApiProperty({ description: 'Размер скидки' })
  discount: number;

  @ApiProperty({ description: 'Процент скидки' })
  discount_percent: number;

  @ApiProperty({ description: 'Базовая цена' })
  base_price: number;

  @ApiProperty({ description: 'Минимальная автоматическая цена' })
  min_auto_price: number;

  @ApiProperty({ description: 'ID предыдущей заявки' })
  prev_task_id: number;

  @ApiProperty({ description: 'Товар поврежден' })
  is_damaged: boolean;

  @ApiProperty({ description: 'Дата модерации' })
  moderated_at: string;

  @ApiProperty({ description: 'Одобренная скидка' })
  approved_discount: number;

  @ApiProperty({ description: 'Одобренный процент скидки' })
  approved_discount_percent: number;

  @ApiProperty({ description: 'Товар куплен' })
  is_purchased: boolean;

  @ApiProperty({ description: 'Автоматически промодерировано' })
  is_auto_moderated: boolean;

  @ApiProperty({ description: 'ID товара' })
  offer_id: string;

  @ApiProperty({ description: 'Email покупателя' })
  email: string;

  @ApiProperty({ description: 'Фамилия покупателя' })
  last_name: string;

  @ApiProperty({ description: 'Имя покупателя' })
  first_name: string;

  @ApiProperty({ description: 'Отчество покупателя' })
  patronymic: string;

  @ApiProperty({ description: 'Минимальное одобренное количество' })
  approved_quantity_min: number;

  @ApiProperty({ description: 'Максимальное одобренное количество' })
  approved_quantity_max: number;

  @ApiProperty({ description: 'Минимальное запрашиваемое количество' })
  requested_quantity_min: number;

  @ApiProperty({ description: 'Максимальное запрашиваемое количество' })
  requested_quantity_max: number;

  @ApiProperty({ description: 'Запрашиваемая цена с комиссией' })
  requested_price_with_fee: number;

  @ApiProperty({ description: 'Одобренная цена с комиссией' })
  approved_price_with_fee: number;

  @ApiProperty({ description: 'Процент комиссии одобренной цены' })
  approved_price_fee_percent: number;
}

export class DiscountTaskListDto {
  @ApiProperty({ type: [DiscountTaskDto], description: 'Список заявок на скидку' })
  result: DiscountTaskDto[];
} 