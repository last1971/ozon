import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { SupplyQrModule } from './supply-qr.module';
import { SupplyQrService } from './supply-qr.service';

describe('SupplyQrModule — старт контейнера Nest', () => {
    it('собирает экран QR поставки FBO (Firebird импортирован)', async () => {
        const module = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true }), SupplyQrModule],
        }).compile();
        expect(module.get(SupplyQrService)).toBeInstanceOf(SupplyQrService);
    });
});
