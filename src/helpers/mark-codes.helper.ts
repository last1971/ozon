import { ConfigService } from '@nestjs/config';

// Явная проверка `=== true || === 'true'` нужна потому что .env передаёт значения как строки.
// `Boolean('false')` вернул бы `true` — поэтому сравниваем с литералом 'true' явно.
export function isMarkCodesEnabled(configService: ConfigService): boolean {
    const v = configService.get<boolean | string>('MARK_CODES_ENABLED', false);
    return v === true || v === 'true';
}

/**
 * Вывод из оборота отправляет очередь Laravel (chz:outbox), а не человек файлом.
 * Пока флаг выключен, вкладка «ЧЗ» работает по-старому: пачка → xlsx → ЛК ГИС МТ.
 * Включён — ручную выгрузку вывода закрываем: иначе один счёт уедет дважды,
 * файлом и документом очереди.
 */
export function isChzAutoRetire(configService: ConfigService): boolean {
    const v = configService.get<boolean | string>('CHZ_AUTO_RETIRE', false);
    return v === true || v === 'true';
}
