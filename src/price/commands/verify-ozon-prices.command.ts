import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { chunk, toNumber } from 'lodash';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { ProductService } from '../../product/product.service';
import { ProductVisibility } from '../../product/product.visibility';
import { NotifyTopic } from '../../notify/notify.types';
import { ExtraPriceService } from '../extra.price.service';
import { UpdatePriceDto } from '../dto/update.price.dto';
import { ProductPriceDto } from '../dto/product.price.dto';
import { describeOzonResult, OzonPriceResult, ozonResultsByOffer } from '../price-update.report';

/** Расхождение в рублях, которое ещё считаем «встало»: Озон хранит целые, мы иногда шлём с копейками. */
const MATCH_RUB = 1;

interface PriceMismatch {
    sent: UpdatePriceDto;
    /** Что лежит на Озоне; undefined — товар в ответе не пришёл. */
    actual?: ProductPriceDto['price'];
}

/**
 * Сверка после отправки цен на Озон: перечитать /v5/product/info/prices и сравнить с отправленным
 * (цена, до скидки, минимальная). Не сошлось — отправить эти же числа ещё раз; снова не сошлось —
 * письмо в тему «цены» списком: товар, что посчитали, что на Озоне, что ответил Озон оба раза.
 * Озон применяет цены не мгновенно — перед чтением ждём PRICE_VERIFY_DELAY_MS (по умолчанию 20 с).
 * Других площадок не касается. Ошибка чтения не роняет цепочку: цены уже отправлены, пишем в лог.
 */
@Injectable()
export class VerifyOzonPricesCommand implements ICommandAsync<IGoodsProcessingContext> {
    private readonly logger = new Logger(VerifyOzonPricesCommand.name);

    constructor(
        @Inject(forwardRef(() => ExtraPriceService))
        private readonly extraPriceService: ExtraPriceService,
        private readonly product: ProductService,
        private readonly configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        const report = (context.priceReports || []).find((r) => r.service === GoodServiceEnum.OZON);
        if (!report?.sent.length) return context;
        try {
            await this.verify(report.sent, ozonResultsByOffer(report.response));
        } catch (e) {
            this.logger.error(`сверка цен Озона не выполнена — ${e.message}`);
        }
        return context;
    }

    private async verify(sent: UpdatePriceDto[], firstAnswers: Map<string, OzonPriceResult>): Promise<void> {
        let mismatches = await this.compare(sent);
        if (mismatches.length === 0) {
            this.logger.log(`цены Озона встали: ${sent.length} из ${sent.length}`);
            return;
        }
        this.logger.warn(
            `цены Озона не встали у ${mismatches.length} из ${sent.length} (${mismatches.map((m) => m.sent.offer_id).join(', ')}) — отправляем ещё раз`,
        );
        const retrySent = mismatches.map((m) => m.sent);
        const retryAnswers = ozonResultsByOffer(
            await this.extraPriceService.getService(GoodServiceEnum.OZON).updatePrices(retrySent),
        );
        mismatches = await this.compare(retrySent);
        if (mismatches.length === 0) {
            this.logger.log(`цены Озона встали со второго раза: ${retrySent.length}`);
            return;
        }
        const lines = mismatches.map(
            (m) =>
                `${m.sent.offer_id}: посчитали ${prices(m.sent)} — на Озоне ${m.actual ? prices(m.actual) : 'нет данных'}` +
                ` — Озон ответил: ${describeOzonResult(firstAnswers.get(m.sent.offer_id))}, на повтор: ${describeOzonResult(retryAnswers.get(m.sent.offer_id))}`,
        );
        this.logger.error(`цены Озона не встали и после повтора:\n${lines.join('\n')}`);
        this.eventEmitter.emit(
            'error.message',
            `Цены Озона не встали: ${mismatches.length}`,
            `Отправили дважды, на Озоне другие цены (цена/до скидки/мин):\n${lines.join('\n')}`,
            NotifyTopic.PRICES,
        );
    }

    /** Подождать, пока Озон применит, перечитать и вернуть те, что не совпали с отправленным. */
    private async compare(sent: UpdatePriceDto[]): Promise<PriceMismatch[]> {
        const delay = Number(this.configService.get('PRICE_VERIFY_DELAY_MS', 20000));
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delay) ? delay : 20000));
        const actual = new Map<string, ProductPriceDto['price']>();
        for (const part of chunk(sent, 1000)) {
            const response = await this.product.getPrices({
                offer_id: part.map((s) => s.offer_id),
                limit: part.length,
                visibility: ProductVisibility.ALL,
            });
            for (const item of response.items || []) actual.set(String(item.offer_id), item.price);
        }
        return sent
            .map((s) => ({ sent: s, actual: actual.get(s.offer_id) }))
            .filter((m) => !m.actual || !same(m.sent, m.actual));
    }
}

function same(sent: UpdatePriceDto, actual: ProductPriceDto['price']): boolean {
    return (['price', 'old_price', 'min_price'] as const).every(
        (f) => Math.abs(toNumber(sent[f]) - toNumber(actual[f])) <= MATCH_RUB,
    );
}

function prices(p: { price?: string | number; old_price?: string | number; min_price?: string | number }): string {
    return `${toNumber(p.price)}/${toNumber(p.old_price)}/${toNumber(p.min_price)}`;
}
