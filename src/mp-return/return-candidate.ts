import { InvoiceMatchDto } from '../invoice/dto/invoice.match.dto';
import { ReturnLineDto } from './dto/return-line.dto';

/** Внутренние варианты номера счёта; в ответ API они не попадают. Порядок задаёт источник. */
export interface ReturnCandidate extends ReturnLineDto {
    postingCandidates?: { posting: string; schema: string | null }[];
}

export function candidatePostings(candidates: ReturnCandidate[]): string[] {
    return [
        ...new Set(
            candidates
                .flatMap((c) => (c.postingCandidates ? c.postingCandidates.map((p) => p.posting) : [c.posting]))
                .filter(Boolean),
        ),
    ];
}

export function resolveCandidates(
    candidates: ReturnCandidate[],
    matches: Map<string, InvoiceMatchDto>,
): ReturnLineDto[] {
    return candidates.map(({ postingCandidates, ...line }) => {
        const selected = postingCandidates?.find((p) => matches.has(p.posting));
        return selected ? { ...line, ...selected } : line;
    });
}
