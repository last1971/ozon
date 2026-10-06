import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { randomBytes } from 'crypto';
import { INotifyTransport, NotifyMessage } from './notify.types';

export const MATRIX_MAX_LENGTH = 4000;
const TIMEOUT_MS = 5000;

/**
 * Один HTTP-вызов Client-Server API homeserver'а от имени бота. Процесс
 * matrix_bot в отправке не участвует. Ничего не знает о маршрутах и очереди:
 * неудача — просто false, повтор решает NotifierService через NotifyRetryService.
 */
@Injectable()
export class MatrixTransport implements INotifyTransport {
    readonly channel = 'matrix' as const;
    private readonly logger = new Logger(MatrixTransport.name);
    private readonly homeserver: string | null;
    private readonly token: string | null;

    constructor(config: ConfigService) {
        this.homeserver = (config.get<string>('MATRIX_HOMESERVER') || '').replace(/\/+$/, '') || null;
        this.token = config.get<string>('MATRIX_ACCESS_TOKEN') || null;
    }

    configured(): boolean {
        return !!(this.homeserver && this.token);
    }

    async send(roomId: string, message: NotifyMessage): Promise<boolean> {
        const result = await this.deliver(roomId, message);
        if (!result.ok) this.logger.error(`matrix ${roomId}: ${result.status ?? '—'} ${result.error}`);
        return result.ok;
    }

    /** Живая отправка с ответом сервера — для кнопки «тест» и повтора. Один ретрай на 429/5xx. */
    async deliver(roomId: string, message: NotifyMessage): Promise<{ ok: boolean; status?: number; error?: string }> {
        if (!this.configured()) {
            return { ok: false, error: 'MATRIX_HOMESERVER / MATRIX_ACCESS_TOKEN не заданы' };
        }
        const content = MatrixTransport.content(message);
        let last: { ok: boolean; status?: number; error?: string } = { ok: false };
        for (let attempt = 0; attempt < 2; attempt++) {
            last = await this.put(roomId, content);
            if (last.ok || !(last.status === 429 || (last.status ?? 0) >= 500)) break;
        }
        return last;
    }

    /**
     * Тело события: plain body + HTML; длинное режется, хвост уходит письмом по той же теме.
     * В первой строке — время события (Томск, время склада и серверов): в ленте Element
     * из десятков одинаковых заголовков не видно, какой когда пришёл и что уже прочитано
     * (жалоба владельца 06.10.2026).
     */
    static content(message: NotifyMessage, now: Date = new Date()): Record<string, any> {
        const title = `${message.subject} · ${MatrixTransport.stamp(now)}`;
        const { body, cut } = MatrixTransport.truncate(`${title}\n${message.text}`.trim());
        const html =
            message.html && !cut
                ? `<b>${escape(title)}</b><br>${message.html}`
                : escape(body)
                      .replace(/\n/g, '<br>')
                      .replace(/^([^<]+)/, '<b>$1</b>');
        return {
            msgtype: message.notice ? 'm.notice' : 'm.text',
            body,
            format: 'org.matrix.custom.html',
            formatted_body: html,
        };
    }

    /** «06.10 14:38» по Томску — часовой пояс склада и обоих прод-узлов, не зависит от TZ процесса. */
    static stamp(now: Date): string {
        return now
            .toLocaleString('ru-RU', {
                timeZone: 'Asia/Tomsk',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            })
            .replace(',', '');
    }

    static truncate(text: string): { body: string; cut: boolean } {
        if (text.length <= MATRIX_MAX_LENGTH) return { body: text, cut: false };
        const head = text.slice(0, MATRIX_MAX_LENGTH);
        const kept = head.slice(0, head.lastIndexOf('\n') > 0 ? head.lastIndexOf('\n') : MATRIX_MAX_LENGTH);
        const dropped = text
            .slice(kept.length)
            .split('\n')
            .filter((line) => line.trim()).length;
        return { body: `${kept}\n…ещё ${dropped} строк, полный текст в письме`, cut: true };
    }

    private async put(
        roomId: string,
        content: Record<string, any>,
    ): Promise<{ ok: boolean; status?: number; error?: string }> {
        const txn = `ozon-${Date.now()}-${randomBytes(4).toString('hex')}`;
        const url = `${this.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`;
        try {
            const response = await axios.put(url, content, {
                timeout: TIMEOUT_MS,
                headers: { Authorization: `Bearer ${this.token}` },
            });
            return { ok: true, status: response.status };
        } catch (e) {
            const err = e as AxiosError<any>;
            const status = err.response?.status;
            const data = err.response?.data;
            const error = data ? JSON.stringify(data).slice(0, 300) : err.message;
            return { ok: false, status, error };
        }
    }
}

function escape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
