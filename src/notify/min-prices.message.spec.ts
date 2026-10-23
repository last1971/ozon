import { ozonPromoSweepMessage, wbMinPricesMessage } from './formatters';

describe('сообщения «к минимальной»', () => {
    it('ВБ: подняли / опустили / база ниже минимальной, без пуша', () => {
        const m = wbMinPricesMessage({
            changes: [
                { article: '526388', from: 57, to: 31, buyerAfter: 1250 },
                { article: 'A', from: 5, to: 20, buyerAfter: 80 },
            ],
            belowMin: ['B'],
            errors: ['C: нет min_price в Firebird'],
            uploadId: '173721337',
        });
        expect(m.subject).toBe('ВБ к минимальной: подняли 1, опустили 1');
        expect(m.text).toContain('526388: скидка 57 → 31 %, покупателю 1250');
        expect(m.text).toContain('База «до скидки» ниже минимальной');
        expect(m.text).toContain('Задача ВБ: 173721337');
        expect(m.notice).toBe(true);
    });

    it('Озон: применено и не прошло с причиной; товары без шагов не считаются', () => {
        const m = ozonPromoSweepMessage({
            items: [
                { offerId: '513498', steps: [{}], applied: true },
                { offerId: '552293', steps: [{}], applied: false, results: [{ status: 'rejected', reason: 'лимит' }] },
                { offerId: '542774', steps: [] },
            ],
            keptInOzon: 0,
            removedFromOzon: 0,
            percentChanged: 2,
            nothingToDo: 0,
        });
        expect(m.subject).toBe('Озон акции к минимальной: применено 1, не прошло 1');
        expect(m.text).toContain('552293: лимит');
        expect(m.text).not.toContain('542774');
    });

    it('длинный список режется на 20 строк с хвостом «и ещё»', () => {
        const changes = Array.from({ length: 25 }, (_, i) => ({ article: `x${i}`, from: 50, to: 30, buyerAfter: 100 }));
        expect(wbMinPricesMessage({ changes, belowMin: [], errors: [], uploadId: null }).text).toContain('… и ещё 5');
    });
});
