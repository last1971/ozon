import { parseReturnScan } from './return-scan.parser';

describe('parseReturnScan', () => {
    it.each([
        ['ii18506448347', { kind: 'barcode', value: 'ii18506448347' }],
        ['ii1850644 8347', { kind: 'barcode', value: 'ii18506448347' }],
        ['  II50029192978 ', { kind: 'barcode', value: 'ii50029192978' }],
        ['шш5002936 3008', { kind: 'barcode', value: 'ii50029363008' }],
        ['0103411105-0207-1', { kind: 'posting', value: '0103411105-0207-1' }],
        ['60350835-0906-1', { kind: 'posting', value: '60350835-0906-1' }],
        ['https://x/?p=0177240708-0022-2&z=1', { kind: 'posting', value: '0177240708-0022-2' }],
        ['0103411105-0207', { kind: 'order', value: '0103411105-0207' }],
        ['1001644468', { kind: 'extId', value: '1001644468' }],
        ['VOZ_FBS_27059326', { kind: 'barcode', value: 'VOZ_FBS_27059326' }],
        ['мщя_аиы_27059326', { kind: 'barcode', value: 'VOZ_FBS_27059326' }],
        ['62026013058-1', { kind: 'barcode', value: '62026013058-1' }],
    ])('%s', (raw, expected) => {
        expect(parseReturnScan(raw)).toEqual(expected);
    });

    it.each(['', '   ', 'abc', '12'])('пусто/мусор «%s» → null', (raw) => {
        expect(parseReturnScan(raw)).toBeNull();
    });
});
