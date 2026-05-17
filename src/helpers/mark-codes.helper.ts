import { ConfigService } from '@nestjs/config';

// Явная проверка `=== true || === 'true'` нужна потому что .env передаёт значения как строки.
// `Boolean('false')` вернул бы `true` — поэтому сравниваем с литералом 'true' явно.
export function isMarkCodesEnabled(configService: ConfigService): boolean {
    const v = configService.get<boolean | string>('MARK_CODES_ENABLED', false);
    return v === true || v === 'true';
}
