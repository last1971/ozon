import { Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PriceModule } from '../price/price.module';
import { PromosModule } from '../promos/promos.module';
import { LossPriceUpdateModule } from '../marketplace-loss/prices/loss-price-update.module';
import { IncomingPricesCommand } from '../price/commands/incoming-prices.command';
import { ExtraPriceService } from '../price/extra.price.service';
import { MarketPriceWorkflowService } from '../marketplace-loss/prices/market-price-workflow.service';

@Module({})
class BoundaryModule {}
it('реальные модули цен/акций/общих команд разрешают зависимости, без подключения БД/API', async () => {
    const core = [PriceModule, PromosModule, LossPriceUpdateModule];
    const boundary = new Set<any>();
    for (const module of core)
        for (const dependency of Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ?? []) {
            const type = dependency.forwardRef ? dependency.forwardRef() : dependency;
            if (!core.includes(type)) boundary.add(type);
        }
    let builder = Test.createTestingModule({ imports: [PriceModule] });
    for (const module of boundary) builder = builder.overrideModule(module).useModule(BoundaryModule);
    const module = await builder
        .useMocker((token) =>
            token === ConfigService
                ? { get: (_key: string, fallback?: any) => fallback }
                : new Proxy({}, { get: (_target, key) => (key === 'then' ? undefined : jest.fn()) }),
        )
        .compile();
    expect(module.get(IncomingPricesCommand)).toBeInstanceOf(IncomingPricesCommand);
    expect(module.get(MarketPriceWorkflowService)).toBeInstanceOf(MarketPriceWorkflowService);
    const chain = module.get(ExtraPriceService).incomingGoodsChain();
    expect((chain as any).commands).toContain(module.get(IncomingPricesCommand));
    await module.close();
});
