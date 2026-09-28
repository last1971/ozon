import { ConfigService } from '@nestjs/config';
import { NotifyInstance } from './notify.types';

/**
 * Какая это инсталляция. INSTANCE в env — явно; без него — по имени базы:
 * magazin.fdb — розница, всё остальное — опт. Обязательным INSTANCE не делаем:
 * опт деплоится руками, и обязательный env положил бы его до правки .env.
 */
export function resolveInstance(config: ConfigService): NotifyInstance {
    const explicit = (config.get<string>('INSTANCE') || '').trim().toLowerCase();
    if (explicit === 'opt' || explicit === 'shop') return explicit;
    // На опте FB_BASE = «opt.fdb#magazin.fdb» — смотрим только основную базу, до «#».
    const base = (config.get<string>('FB_BASE') || '').split('#')[0].toLowerCase();
    return base.includes('magazin') ? 'shop' : 'opt';
}

/** Тег в заголовке — один и тот же в ozon и Trade. */
export function instanceTag(instance: NotifyInstance): string {
    return instance === 'shop' ? '[розница]' : '[опт]';
}
