import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MATRIX_MAX_LENGTH, MatrixTransport } from './matrix.transport';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function config(env: Record<string, string>): ConfigService {
    return { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
}

describe('MatrixTransport', () => {
    beforeEach(() => mockedAxios.put.mockReset());

    it('без MATRIX_* — не настроен, deliver возвращает ошибку без HTTP', async () => {
        const t = new MatrixTransport(config({}));
        expect(t.configured()).toBe(false);
        const result = await t.deliver('!r:s', { subject: 's', text: 't' });
        expect(result.ok).toBe(false);
        expect(mockedAxios.put).not.toHaveBeenCalled();
    });

    it('PUT в Client-Server API с Bearer, room id экранирован, msgtype по notice', async () => {
        mockedAxios.put.mockResolvedValue({ status: 200 });
        const t = new MatrixTransport(config({ MATRIX_HOMESERVER: 'https://hs/', MATRIX_ACCESS_TOKEN: 'tok' }));
        await expect(t.send('!abc:elcopro.ru', { subject: 'Тема', text: 'тело', notice: true })).resolves.toBe(true);
        const [url, content, opts] = mockedAxios.put.mock.calls[0] as [string, any, any];
        expect(url).toMatch(
            /^https:\/\/hs\/_matrix\/client\/v3\/rooms\/!abc%3Aelcopro\.ru\/send\/m\.room\.message\/ozon-/,
        );
        expect(content).toMatchObject({ msgtype: 'm.notice', format: 'org.matrix.custom.html' });
        expect(content.body).toMatch(/^Тема · \d\d\.\d\d \d\d:\d\d\nтело$/);
        expect(content.formatted_body).toMatch(/^<b>Тема · \d\d\.\d\d \d\d:\d\d<\/b><br>тело$/);
        expect(opts.headers.Authorization).toBe('Bearer tok');
    });

    it('время в заголовке — по Томску, «дд.мм чч:мм»', () => {
        const at = new Date('2026-10-06T07:38:00Z'); // 14:38 в Томске (+07)
        expect(MatrixTransport.stamp(at)).toBe('06.10 14:38');
        expect(MatrixTransport.content({ subject: 'Разобрать руками: 2', text: 'x' }, at).body).toBe(
            'Разобрать руками: 2 · 06.10 14:38\nx',
        );
    });

    it('один ретрай на 5xx, потом false; на 4xx ретрая нет', async () => {
        const t = new MatrixTransport(config({ MATRIX_HOMESERVER: 'https://hs', MATRIX_ACCESS_TOKEN: 'tok' }));
        mockedAxios.put.mockRejectedValue({ response: { status: 502, data: 'bad gateway' }, message: '502' });
        await expect(t.send('!r:s', { subject: 's', text: 't' })).resolves.toBe(false);
        expect(mockedAxios.put).toHaveBeenCalledTimes(2);

        mockedAxios.put.mockReset();
        mockedAxios.put.mockRejectedValue({
            response: { status: 403, data: { errcode: 'M_FORBIDDEN' } },
            message: '403',
        });
        const result = await t.deliver('!r:s', { subject: 's', text: 't' });
        expect(result).toMatchObject({ ok: false, status: 403 });
        expect(result.error).toContain('M_FORBIDDEN');
        expect(mockedAxios.put).toHaveBeenCalledTimes(1);
    });

    it('длинное тело режется по строке с хвостом «…ещё N строк»', () => {
        const lines = Array.from({ length: 500 }, (_, i) => `строка ${i} ${'x'.repeat(20)}`);
        const { body, cut } = MatrixTransport.truncate(lines.join('\n'));
        expect(cut).toBe(true);
        expect(body.length).toBeLessThanOrEqual(MATRIX_MAX_LENGTH + 60);
        expect(body).toMatch(/…ещё \d+ строк, полный текст в письме$/);
        expect(MatrixTransport.truncate('коротко')).toEqual({ body: 'коротко', cut: false });
    });

    it('HTML экранируется, свой html берётся как есть', () => {
        const at = new Date('2026-10-06T07:38:00Z');
        expect(MatrixTransport.content({ subject: 'a<b', text: 'c>d' }, at).formatted_body).toBe(
            '<b>a&lt;b · 06.10 14:38</b><br>c&gt;d',
        );
        expect(MatrixTransport.content({ subject: 's', text: 't', html: '<i>x</i>' }, at).formatted_body).toBe(
            '<b>s · 06.10 14:38</b><br><i>x</i>',
        );
    });
});
