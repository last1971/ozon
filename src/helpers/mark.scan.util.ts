import { BadRequestException } from '@nestjs/common';

// Разделители, которые разные сканеры вставляют между AI(21) и AI(91):
//   GS     — стандартный FNC1/Group Separator (ASCII 29 / U+001D)
//   ALT_GS — C1-вариант, который шлёт часть моделей (U+0093)
const GS = '';
const ALT_GS = '';

/**
 * 2026-06-02 (changed): + понимание скобочного формата сканера (01)..(21)..;
 * обрезка хвоста переведена на поиск пары 91..92 (было: 91/92 по отдельности).
 *
 * Извлекает чистый KI из любого представления КМ. Единая точка разбора в проекте.
 * Понимает три формата, которые отдают разные сканеры/источники:
 *   1) скобочный AI:  (01)GTIN(21)SERIAL(91)..(92)..  — убираем скобки маркеров
 *   2) с разделителем GS/ALT_GS между AI(21) и AI(91)  — режем по разделителю
 *   3) плоский без разделителей                          — режем по паре 91..92
 * KI имеет вид '01'+GTIN(14)+'21'+serial(1..20), длина 19..38.
 */
export function extractKi(rawScan: string): string {
    if (!rawScan) throw new BadRequestException('Пустой код маркировки');

    // (1) скобочный формат сканера: (01)..(21)..(91).. -> плоский вид.
    // Убираем только маркеры AI вида "(NN)", данные не трогаем.
    let s = rawScan.trim().replace(/\((\d{2})\)/g, '$1');

    // (2) разделитель GS / ALT_GS
    const sepIdx = [s.indexOf(GS), s.indexOf(ALT_GS)].filter((i) => i > 0).sort((a, b) => a - b)[0];
    if (sepIdx !== undefined) {
        s = s.substring(0, sepIdx);
    } else {
        // (3) плоский: crypto-хвост = AI(91) + 4 символа ключа + AI(92).
        // Ищем пару "91".."92" в позициях начала хвоста (19..38), а не в серийнике.
        for (let i = 19; i <= 38 && i + 8 <= s.length; i++) {
            if (s[i] === '9' && s[i + 1] === '1' && s[i + 6] === '9' && s[i + 7] === '2') {
                s = s.substring(0, i);
                break;
            }
        }
    }

    s = s.trim();
    if (s.length < 19 || s.length > 50) {
        throw new BadRequestException(`Некорректная длина КМ (${s.length})`);
    }
    if (!s.startsWith('01')) {
        throw new BadRequestException('КМ должен начинаться с AI 01 (GTIN)');
    }
    return s;
}

/**
 * GTIN(14) из KI. '' если KI невалиден: нет префикса '01', нет '21' в поз.17 (1-based),
 * или короче 19 символов. Единственная реализация — звать только отсюда.
 */
export function extractGtin(ki: string): string {
    if (!ki || ki.length < 19) return '';
    if (ki.substring(0, 2) !== '01') return '';
    if (ki.substring(16, 18) !== '21') return '';
    return ki.substring(2, 16);
}
