import { assessReturnLine, AssessInput, returnRowStatus } from './assess-return-line';

const base = (): AssessInput => ({
    line: {
        service: 'OZON',
        extId: '1',
        posting: '60350835-0906-1',
        offerId: '538612',
        productName: 'NUCLEO',
        units: 1,
        reason: 'Покупатель отменил заказ: нашел дешевле',
        isBuyout: false,
        isOpened: false,
        receivedAt: '2026-10-13T08:01:00Z',
        barcode: 'ii50029192978',
        schema: 'Fbs',
        stateName: 'Получен',
    },
    invoice: {
        scode: 96962,
        number: 20008,
        date: null,
        status: 0,
        prim: '60350835-0906-1 возврат в пути',
        mark: ' возврат в пути',
        isDonor: false,
    },
    invoiceLine: {
        realpricecode: 1,
        goodscode: '538612',
        name: 'NUCLEO',
        quantity: 1,
        pieces: 1,
        podbposcode: 5,
        picked: 1,
        need: 0,
        shipped: 0,
    },
    codes: [],
    quan: 1,
    marksRequired: false,
    accepted: null,
});

describe('assessReturnLine', () => {
    it('обычный возврат — можно принять, ручная пометка в предупреждениях', () => {
        const a = assessReturnLine(base());
        expect(a.blockers).toEqual([]);
        expect(a.canAccept).toBe(true);
        expect(a.warnings).toContain('В примечании счёта пометка «возврат в пути» — поставлена руками');
    });

    it('счёта нет — нельзя', () => {
        const a = assessReturnLine({ ...base(), invoice: null });
        expect(a.canAccept).toBe(false);
        expect(a.blockers[0]).toMatch(/Счёт по отправлению не найден/);
    });

    it('закрытый счёт и УПД — «оприходуйте»', () => {
        expect(assessReturnLine({ ...base(), invoice: { ...base().invoice, status: 5 } }).blockers).toContain(
            'Счёт закрыт — возврат невозможен, оприходуйте товар',
        );
        const shipped = { ...base(), invoiceLine: { ...base().invoiceLine, shipped: 1 } };
        expect(assessReturnLine(shipped).blockers).toContain(
            'По строке выписан УПД — возврат невозможен, оприходуйте товар',
        );
    });

    it('подобрано меньше вернувшегося', () => {
        const a = assessReturnLine({ ...base(), quan: 10 });
        expect(a.blockers).toContain('На строке подобрано 1, вернулось 10');
    });

    it('маркируемый: кодов меньше штук, FBO-коды, чужой вывод', () => {
        const code = { ki: 'k', quantity: 1, status: 5, transferType: 3, retireReason: null, chzSent: false };
        const short = assessReturnLine({ ...base(), marksRequired: true, quan: 1, codes: [] });
        expect(short.blockers).toContain('На строке кодов на 0 шт, вернулось 1');
        const fbo = assessReturnLine({ ...base(), marksRequired: true, codes: [{ ...code, transferType: 2 }] });
        expect(fbo.blockers).toContain('Коды строки переданы по FBO — разобрать руками');
        const foreign = assessReturnLine({
            ...base(),
            marksRequired: true,
            codes: [{ ...code, status: 6, retireReason: 2 }],
        });
        expect(foreign.blockers[0]).toMatch(/выведен не продажей/);
        const sold = assessReturnLine({
            ...base(),
            marksRequired: true,
            codes: [{ ...code, status: 6, retireReason: 1, chzSent: true }],
        });
        expect(sold.canAccept).toBe(true);
        expect(sold.warnings).toContain('Марки выведены продажей в Честном знаке — вернуть в оборот отдельно');
    });

    it('количественный код покрывает фасовку', () => {
        const code = { ki: 'k', quantity: 10, status: 5, transferType: 3, retireReason: null, chzSent: false };
        const a = assessReturnLine({
            ...base(),
            quan: 10,
            marksRequired: true,
            codes: [code],
            invoiceLine: { ...base().invoiceLine, picked: 10, pieces: 10 },
        });
        expect(a.blockers).toEqual([]);
    });

    it('брак и вскрытие — предупреждения', () => {
        const a = assessReturnLine({
            ...base(),
            line: { ...base().line, reason: 'Товар не работает / брак', isOpened: true },
        });
        expect(a.warnings).toEqual(
            expect.arrayContaining(['Брак по словам покупателя — проверить до приёма', 'Покупатель вскрывал упаковку']),
        );
    });

    it('принятый — принимать нельзя, списать можно до списания', () => {
        const accepted = {
            decision: 'RETURN' as const,
            username: 'u',
            createdAt: 'x',
            kis: [],
            comment: null,
            spisCode: null,
            spisAt: null,
        };
        const a = assessReturnLine({ ...base(), accepted });
        expect(a.canAccept).toBe(false);
        expect(a.canWriteOff).toBe(true);
        expect(assessReturnLine({ ...base(), accepted: { ...accepted, spisCode: 5 } }).canWriteOff).toBe(false);
        expect(returnRowStatus({ ...accepted, spisCode: 5 }, [])).toBe('written-off');
        expect(returnRowStatus(null, ['x'])).toBe('blocked');
        expect(returnRowStatus({ ...accepted, decision: 'PROBLEM' }, [])).toBe('problem');
    });
});
