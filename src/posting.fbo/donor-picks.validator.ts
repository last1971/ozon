import { InvoiceDonorsDto } from '../invoice/dto/invoice-donors.dto';
import { DonorPickDto } from './dto/fbo-shortage-apply.dto';

/** Выверенный выбор: строка, донор и номинал уже сопоставлены с предложением. */
export interface DonorPickPlan {
    realpricecode: number;
    goodscode: string;
    nominal: number;
    donor: { podbposcode: number; scode: number; realpricecode: number; invoiceNumber: number };
    quantity: number;
}

/**
 * Проверка выбора донора против свежего предложения. Чистая функция — та же логика на фронте
 * подсвечивает, а здесь решает. Правила:
 *  - трогать можно только строки с недобором, и по каждой тронутой строке Σ взять = недобор ровно;
 *  - донор из предложения этой строки и с canTake; с одного донора суммарно не больше, чем на нём подобрано;
 *  - номинал строки известен (PIECES либо nominals[realpricecode]) и «взять» кратно ему;
 *  - количество — целое больше нуля.
 */
export function validatePicks(
    offer: InvoiceDonorsDto,
    picks: DonorPickDto[],
    nominals: Record<string, number> = {},
): { errors: string[]; plan: DonorPickPlan[] } {
    const errors: string[] = [];
    const plan: DonorPickPlan[] = [];
    if (!picks?.length) return { errors: ['ничего не выбрано'], plan };

    const lines = new Map(offer.lines.map((l) => [Number(l.realpricecode), l]));
    const perLine = new Map<number, number>();
    const perDonor = new Map<number, number>();

    for (const pick of picks) {
        const rpc = Number(pick.realpricecode);
        const qty = Number(pick.quantity);
        const line = lines.get(rpc);
        if (!line) {
            errors.push(`строка ${rpc}: нет в счёте`);
            continue;
        }
        const label = `${line.name ?? line.goodscode} (строка ${rpc})`;
        if (!Number.isInteger(qty) || qty <= 0) {
            errors.push(`${label}: количество должно быть целым больше нуля`);
            continue;
        }
        if (line.shortage <= 0) {
            errors.push(`${label}: недобора нет`);
            continue;
        }
        const nominal = line.pieces ?? Number(nominals[String(rpc)] ?? 0);
        if (!Number.isInteger(nominal) || nominal <= 0) {
            errors.push(`${label}: фасовка неизвестна — укажите номинал кода`);
            continue;
        }
        if (qty % nominal !== 0) {
            errors.push(`${label}: ${qty} шт не кратно фасовке ${nominal}`);
            continue;
        }
        const donor = line.donors.find((d) => Number(d.podbposcode) === Number(pick.podbposcode));
        if (!donor) {
            errors.push(`${label}: донор ${pick.podbposcode} не из предложения`);
            continue;
        }
        if (donor.canTake === false) {
            errors.push(`${label}: со счёта №${donor.invoiceNumber} брать нельзя — ${donor.reason ?? 'не годится'}`);
            continue;
        }
        perLine.set(rpc, (perLine.get(rpc) ?? 0) + qty);
        perDonor.set(donor.podbposcode, (perDonor.get(donor.podbposcode) ?? 0) + qty);
        if (perDonor.get(donor.podbposcode) > donor.quantity) {
            errors.push(`${label}: со счёта №${donor.invoiceNumber} взято ${perDonor.get(donor.podbposcode)}, подобрано там ${donor.quantity}`);
            continue;
        }
        plan.push({
            realpricecode: rpc,
            goodscode: String(line.goodscode),
            nominal,
            donor: { podbposcode: donor.podbposcode, scode: donor.scode, realpricecode: donor.realpricecode, invoiceNumber: donor.invoiceNumber },
            quantity: qty,
        });
    }

    for (const [rpc, sum] of perLine) {
        const line = lines.get(rpc);
        if (sum !== line.shortage) {
            errors.push(`${line.name ?? line.goodscode} (строка ${rpc}): взято ${sum} из ${line.shortage} — нужно ровно ${line.shortage}`);
        }
    }
    return { errors: [...new Set(errors)], plan: errors.length ? [] : plan };
}
