import { validatePicks } from './donor-picks.validator';
import { InvoiceDonorsDto } from '../invoice/dto/invoice-donors.dto';

describe('validatePicks', () => {
    const donor = (podbposcode: number, quantity: number, extra: Partial<InvoiceDonorsDto['lines'][0]['donors'][0]> = {}) => ({
        invoiceNumber: podbposcode * 10,
        scode: podbposcode * 100,
        date: null,
        prim: null,
        podbposcode,
        realpricecode: podbposcode + 1,
        quantity,
        canTake: true,
        ...extra,
    });
    const offer: InvoiceDonorsDto = {
        invoiceNumber: 1, scode: 500, status: 1, date: null, prim: 'P-1', buyerCode: 7, inShortage: true,
        lines: [
            { realpricecode: 900, goodscode: '444', name: 'Реле', quantity: 10, pieces: 1, picked: 0, shortage: 10, inShortage: true,
              donors: [donor(1, 6), donor(2, 4), donor(3, 9, { canTake: false, reason: 'код не делится' })] },
            { realpricecode: 901, goodscode: '555', name: 'Паста', quantity: 3, pieces: 3, picked: 0, shortage: 3, inShortage: true,
              donors: [donor(4, 6)] },
            { realpricecode: 902, goodscode: '666', name: 'Ок', quantity: 2, pieces: 1, picked: 2, shortage: 0, inShortage: false, donors: [] },
            { realpricecode: 903, goodscode: '777', name: 'Старый', quantity: 2, pieces: null, picked: 0, shortage: 2, inShortage: true,
              donors: [donor(5, 5)] },
        ],
    };

    it('6 с одного и 4 с другого закрывают строку ровно → план', () => {
        const res = validatePicks(offer, [
            { realpricecode: 900, podbposcode: 1, quantity: 6 },
            { realpricecode: 900, podbposcode: 2, quantity: 4 },
        ]);
        expect(res.errors).toEqual([]);
        expect(res.plan.map((p) => [p.donor.podbposcode, p.quantity, p.nominal])).toEqual([[1, 6, 1], [2, 4, 1]]);
    });

    it('недобор и перебор по строке, лишнее с донора, чужой донор, строка без недобора', () => {
        const { errors, plan } = validatePicks(offer, [
            { realpricecode: 900, podbposcode: 1, quantity: 4 },
            { realpricecode: 901, podbposcode: 4, quantity: 6 },
            { realpricecode: 902, podbposcode: 1, quantity: 1 },
            { realpricecode: 900, podbposcode: 99, quantity: 1 },
        ]);
        expect(plan).toEqual([]);
        expect(errors).toEqual(expect.arrayContaining([
            expect.stringContaining('Реле (строка 900): взято 4 из 10'),
            expect.stringContaining('Паста (строка 901): взято 6 из 3'),
            expect.stringContaining('Ок (строка 902): недобора нет'),
            expect.stringContaining('донор 99 не из предложения'),
        ]));
    });

    it('донор с кодами чужого номинала и некратность фасовке', () => {
        const { errors } = validatePicks(offer, [
            { realpricecode: 900, podbposcode: 3, quantity: 10 },
            { realpricecode: 901, podbposcode: 4, quantity: 2 },
        ]);
        expect(errors).toEqual(expect.arrayContaining([
            expect.stringContaining('со счёта №30 брать нельзя — код не делится'),
            expect.stringContaining('2 шт не кратно фасовке 3'),
        ]));
    });

    it('с одного донора суммарно по двум строкам не больше подобранного', () => {
        const twoLines: InvoiceDonorsDto = {
            ...offer,
            lines: [
                { ...offer.lines[0], realpricecode: 900, shortage: 4, quantity: 4, donors: [donor(1, 6)] },
                { ...offer.lines[0], realpricecode: 904, shortage: 4, quantity: 4, donors: [donor(1, 6)] },
            ],
        };
        const { errors } = validatePicks(twoLines, [
            { realpricecode: 900, podbposcode: 1, quantity: 4 },
            { realpricecode: 904, podbposcode: 1, quantity: 4 },
        ]);
        expect(errors).toEqual([expect.stringContaining('взято 8, подобрано там 6')]);
    });

    it('строка без фасовки: номинал обязателен и приходит отдельно', () => {
        expect(validatePicks(offer, [{ realpricecode: 903, podbposcode: 5, quantity: 2 }]).errors).toEqual([
            expect.stringContaining('фасовка неизвестна'),
        ]);
        const ok = validatePicks(offer, [{ realpricecode: 903, podbposcode: 5, quantity: 2 }], { '903': 1 });
        expect(ok.errors).toEqual([]);
        expect(ok.plan[0].nominal).toBe(1);
    });
});
