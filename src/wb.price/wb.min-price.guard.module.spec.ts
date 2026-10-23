import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { NotifySweepCommand } from '../promos/price-lever/sweep/notify-sweep.command';
import { WbMinPriceGuard } from './wb.min-price.guard';
import { WbPriceService } from './wb.price.service';

/**
 * Старт контейнера Nest для новых провайдеров кронов «к минимальной»: их зависимости, кроме WbPriceService,
 * берутся из глобальных модулей приложения (ConfigModule isGlobal, EventEmitterModule.forRoot).
 */
describe('кроны «к минимальной» — зависимости собираются из глобальных модулей', () => {
    it('WbMinPriceGuard и NotifySweepCommand создаются контейнером', async () => {
        const module = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), EventEmitterModule.forRoot()],
            providers: [WbMinPriceGuard, NotifySweepCommand, { provide: WbPriceService, useValue: {} }],
        }).compile();
        expect(module.get(WbMinPriceGuard)).toBeInstanceOf(WbMinPriceGuard);
        expect(module.get(NotifySweepCommand)).toBeInstanceOf(NotifySweepCommand);
    });
});
