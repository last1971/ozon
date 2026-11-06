import { Injectable } from '@nestjs/common';
import { LoadLossWriteOffsCommand } from '../../marketplace-loss/loss.commands';
import { MpReturnAcceptStore } from '../../mp-event/mp-return-accept.store';

@Injectable()
export class LoadYandexWriteOffsCommand extends LoadLossWriteOffsCommand {
    constructor(store: MpReturnAcceptStore) {
        super(store);
    }
}
