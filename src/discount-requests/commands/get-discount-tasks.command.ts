import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDiscountProcessingContext } from '../../interfaces/i.discount.processing.context';
import { DiscountRequestsService } from '../discount-requests.service';

@Injectable()
export class GetDiscountTasksCommand implements ICommandAsync<IDiscountProcessingContext> {
  constructor(
    @Inject(forwardRef(() => DiscountRequestsService))
    private readonly discountRequestsService: DiscountRequestsService,
  ) {}

  async execute(context: IDiscountProcessingContext): Promise<IDiscountProcessingContext> {
    const tasks = await this.discountRequestsService.getAllUnprocessedDiscountTasks();
    return { ...context, tasks };
  }
} 