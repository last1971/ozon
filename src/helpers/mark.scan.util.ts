import { BadRequestException } from '@nestjs/common';

const GS = '';
const ALT_GS = '';

export function extractKi(rawScan: string): string {
    if (!rawScan) throw new BadRequestException('Пустой код маркировки');
    let s = rawScan.trim();

    const gsIdx = s.indexOf(GS);
    if (gsIdx > 0) s = s.substring(0, gsIdx);
    else {
        const altIdx = s.indexOf(ALT_GS);
        if (altIdx > 0) s = s.substring(0, altIdx);
        else if (s.length > 31) {
            const ai91 = s.indexOf('91', 31);
            const ai92 = s.indexOf('92', 31);
            const cut = [ai91, ai92].filter((i) => i >= 31).sort((a, b) => a - b)[0];
            if (cut !== undefined) s = s.substring(0, cut);
        }
    }

    if (s.length < 21 || s.length > 50) {
        throw new BadRequestException(`Некорректная длина КМ (${s.length})`);
    }
    if (!s.startsWith('01')) {
        throw new BadRequestException('КМ должен начинаться с AI 01 (GTIN)');
    }
    return s;
}
