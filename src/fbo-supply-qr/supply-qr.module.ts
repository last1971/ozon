import { Module } from '@nestjs/common';
import { FirebirdModule } from '../firebird/firebird.module';
import { SupplyQrController } from './supply-qr.controller';
import { SupplyQrService } from './supply-qr.service';
import { SupplyQrStore } from './supply-qr.store';

/** QR-этикетки экземпляров поставки FBO Озона (план ~/.claude/plans/ozon-fbo-supply-qr.md). */
@Module({
    imports: [FirebirdModule],
    controllers: [SupplyQrController],
    providers: [SupplyQrService, SupplyQrStore],
})
export class SupplyQrModule {}
