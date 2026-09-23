import { Injectable, Logger } from '@nestjs/common';

/**
 * ЕДИНСТВЕННОЕ место, где живёт правило «какой номер ГТД примет Озон».
 * Это требование Озона, а не нашей базы, поэтому оно вынесено из работы с Firebird:
 * база отдаёт номер как есть и ничего не решает.
 *
 * Озон принимает строго 3 части — 8/6/7 цифр (^[0-9]{8}/[0-9]{6}/[0-9]{7}$).
 * В базе номер бывает с хвостом-позицией (10228010/260326/5094327/2) — режем до 3 частей.
 * У старых партий (до ~2011) в номере литера — 10210090/160910/п014454; семи цифр там нет
 * и не будет. Такое не чиним, отдаём null: exemplar/set его проглотит, а validate свалится
 * по regex и отгрузка встанет целиком.
 */
@Injectable()
export class OzonGtdFormat {
    private readonly logger = new Logger(OzonGtdFormat.name);
    private static readonly OZON = /^[0-9]{8}\/[0-9]{6}\/[0-9]{7}$/;

    /** Годный номер или null. null здесь означает «этот кандидат не подошёл», а не «ГТД нет». */
    normalize(raw: unknown): string | null {
        if (raw == null) return null;
        const s = String(raw).trim();
        if (!s) return null;
        const gtd = s.split('/').slice(0, 3).join('/');
        if (!OzonGtdFormat.OZON.test(gtd)) {
            this.logger.warn(`ГТД "${s}" не в формате Озона — пропускаем кандидата`);
            return null;
        }
        return gtd;
    }
}
