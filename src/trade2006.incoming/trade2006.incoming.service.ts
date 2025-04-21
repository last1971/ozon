import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { WithTransactions } from "../helpers/transaction.mixin";
import { FIREBIRD } from "../firebird/firebird.module";
import { FirebirdPool } from "ts-firebird";
import { EventEmitter2 } from "@nestjs/event-emitter";

@Injectable()
export class Trade2006IncomingService extends WithTransactions(class {}) implements OnModuleInit {
    private readonly logger = new Logger(Trade2006IncomingService.name);
    private lastShopInCode: number = 0;

    constructor(
        @Inject(FIREBIRD) private pool: FirebirdPool,
        private eventEmitter: EventEmitter2
    ) {
        super();
    }

    // Инициализация при запуске модуля
    async onModuleInit() {
        // Получение максимального SHOPINCODE при старте
        await this.fetchLastShopInCode();
        // this.lastShopInCode = 415096;
        this.logger.log(`Начальный SHOPINCODE: ${this.lastShopInCode}`);
    }


    // Получение максимального SHOPINCODE
    private async fetchLastShopInCode(): Promise<void> {
        return this.withTransaction(async (transaction) => {
            const result = await transaction.query(
                'SELECT MAX(SHOPINCODE) AS MAX_CODE FROM SHOPIN', []
            );

            if (result && result[0] && result[0].MAX_CODE !== null) {
                this.lastShopInCode = Number(result[0].MAX_CODE);
            }
        });
    }

    async checkNewGoods() {
        this.logger.debug(`Проверка новых товаров. Текущий SHOPINCODE: ${this.lastShopInCode}`);

        return this.withTransaction(async (transaction) => {
            // Получаем новые записи с SHOPINCODE больше сохраненного
            const newRecords = await transaction.query(
                'SELECT SHOPINCODE, GOODSCODE FROM SHOPIN WHERE SHOPINCODE > ? ORDER BY SHOPINCODE',
                [this.lastShopInCode],
            );

            if (newRecords && newRecords.length > 0) {
                this.logger.log(`Найдено ${newRecords.length} новых записей`);

                // Собираем все GOODSCODE в массив
                const goodsCodes = newRecords.map(record => record.GOODSCODE);

                // Отправляем событие с массивом всех кодов
                this.eventEmitter.emit('incoming.goods', goodsCodes);

                // Обновляем lastShopInCode до максимального значения
                this.lastShopInCode = Math.max(...newRecords.map(record => Number(record.SHOPINCODE)));

                this.logger.debug(`Обновлен SHOPINCODE до: ${this.lastShopInCode}`);
            } else {
                this.logger.debug('Новых записей не найдено');
            }
        });
    }

    // Метод для ручного обновления и проверки (если нужно)
    async manualCheck(): Promise<void> {
        return this.checkNewGoods();
    }


}