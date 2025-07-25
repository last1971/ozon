import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class EmitUpdatePromosCommand implements ICommandAsync<IGoodsProcessingContext> {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
    this.eventEmitter.emit('update.promos', context.ozonSkus);
    return context;
  }
} 