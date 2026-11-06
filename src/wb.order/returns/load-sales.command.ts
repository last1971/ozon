import { Injectable } from '@nestjs/common';
import { LoadLossHistoryCommand } from '../../marketplace-loss/loss.commands';
import { WbOrderService } from '../wb.order.service';
import { WbLossHistorySource } from './wb-loss-history.source';

/** Только сборка зависимости ВБ. Алгоритм команды общий для площадок. */
@Injectable()
export class LoadWbLossSalesCommand extends LoadLossHistoryCommand {
    constructor(orders: WbOrderService) {
        super(new WbLossHistorySource(orders));
    }
}
