import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import { hostname } from 'os';

// Загружаем переменные окружения из .env файла
dotenv.config();

const execAsync = promisify(exec);

const CONFIG = {
    APP_NAME: 'ozon',
    API_URL: `http://${process.env.APP_HOST || 'localhost'}:${process.env.APP_PORT || '3002'}/api`,
    CPU_THRESHOLD: 90,
    CHECK_INTERVAL: 60000, // 1 минута
    SUMMARY_INTERVAL: 3600000, // сводка раз в час вместо строки на каждый тик
    RESTART_DELAY: 5000,   // 5 секунд после рестарта
    MAX_RETRIES: 3,        // количество попыток проверки перед рестартом
    // База через общий пул сервиса: сам сервис ждёт её 5 с и отвечает 503 (25.10.2026 пул висел 10 часов, /api был жив)
    DB_HEALTH_TIMEOUT: 10000,
    NOTIFY_WAIT: 180000,   // сколько ждать подъёма после рестарта, чтобы сообщить причину
};

class Watchdog {
    private lastRestartTime: number = 0;
    private failedChecks: number = 0;
    /** Причина последнего провала — уходит в сообщение после рестарта. */
    private lastFailure = '';
    /** Печатаем СОБЫТИЕ, а не тик: молчим, пока состояние не изменилось. */
    private lastHealthy: boolean | null = null;
    private lastSummaryAt = 0;
    private ticks = 0;
    private maxCpu = 0;

    async getCpuUsage(pid: string): Promise<number> {
        try {
            const { stdout } = await execAsync(`ps -o %cpu= -p ${pid}`);
            return parseFloat(stdout.trim());
        } catch (error) {
            console.error('Error getting CPU usage:', error);
            return 0;
        }
    }

    async getProcessPid(): Promise<string | null> {
        try {
            const { stdout } = await execAsync(`pm2 pid ${CONFIG.APP_NAME}`);
            const pid = stdout.trim();
            return pid && pid !== '0' ? pid : null;
        } catch (error) {
            console.error('Error getting process PID:', error);
            return null;
        }
    }

    async checkHealth(): Promise<boolean> {
        try {
            // Принудительный timeout через Promise.race
            const controller = new AbortController();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    controller.abort();
                    reject(new Error('Health check timeout'));
                }, 2000);
            });

            const requestPromise = axios.get(CONFIG.API_URL, {
                signal: controller.signal,
                validateStatus: (status) => status === 200
            });

            const response = await Promise.race([requestPromise, timeoutPromise]) as any;
            return typeof response.data === 'string'; // проверяем, что получили строку от getHello()
        } catch (error) {
            console.error('Health check failed:', error.message);
            return false;
        }
    }

    /** База через сервис: 200 — ответила, иначе текст причины. */
    async checkDb(): Promise<string | null> {
        try {
            await axios.get(`${CONFIG.API_URL}/health/db`, {
                timeout: CONFIG.DB_HEALTH_TIMEOUT,
                validateStatus: (status) => status === 200,
            });
            return null;
        } catch (error) {
            const data = error.response?.data;
            return `база: ${data?.error ?? data?.message?.error ?? error.message}`;
        }
    }

    /** После рестарта — сообщение в DEV через сам сервис (его маршруты и доставка), когда он поднимется. */
    async notifyRestart(reason: string): Promise<void> {
        const until = Date.now() + CONFIG.NOTIFY_WAIT;
        while (Date.now() < until) {
            await new Promise((r) => setTimeout(r, CONFIG.RESTART_DELAY));
            if (!(await this.checkHealth()) || (await this.checkDb())) continue;
            try {
                await axios.post(`${CONFIG.API_URL}/notify/event`, {
                    topic: 'DEV',
                    subject: `ozon на ${hostname()} перезапущен сторожем`,
                    text: `${CONFIG.MAX_RETRIES} проверки подряд не прошли: ${reason}. После перезапуска сервис и база отвечают.`,
                });
            } catch (error) {
                console.error('Notify failed:', error.message);
            }
            return;
        }
        console.error(`[${new Date().toISOString()}] После рестарта не поднялся за ${CONFIG.NOTIFY_WAIT / 1000} с — сообщить нечем`);
    }

    async restartApp(): Promise<boolean> {
        const now = Date.now();
        // Предотвращаем слишком частые рестарты
        if (now - this.lastRestartTime < CONFIG.RESTART_DELAY * 2) {
            console.log('Skipping restart: too soon after previous restart');
            return false;
        }

        try {
            console.log(`[${new Date().toISOString()}] Restarting application...`);
            await execAsync(`pm2 restart ${CONFIG.APP_NAME}`);
            this.lastRestartTime = now;
            this.failedChecks = 0;
            console.log(`[${new Date().toISOString()}] Application restarted successfully`);
            void this.notifyRestart(this.lastFailure);
            return true;
        } catch (error) {
            console.error('Error restarting application:', error);
            return false;
        }
    }

    async check(): Promise<void> {
        const pid = await this.getProcessPid();
        if (!pid) {
            console.error(`[${new Date().toISOString()}] Process not found`);
            return;
        }

        const cpuUsage = await this.getCpuUsage(pid);
        this.ticks++;
        this.maxCpu = Math.max(this.maxCpu, cpuUsage);

        // Всегда проверяем health независимо от CPU; базу — только у живого сервиса
        const apiOk = await this.checkHealth();
        const dbFailure = apiOk ? await this.checkDb() : null;
        const isHealthy = apiOk && !dbFailure;

        if (!isHealthy) {
            this.failedChecks++;
            this.lastFailure = dbFailure ?? 'сервис не отвечает на /api';
            console.log(
                `[${new Date().toISOString()}] Health check failed (attempt ${this.failedChecks}/${CONFIG.MAX_RETRIES}): ${this.lastFailure}, CPU ${cpuUsage}%`,
            );

            if (this.failedChecks >= CONFIG.MAX_RETRIES) {
                await this.restartApp();
            }
        } else {
            // Раньше «passed» печатался каждую минуту — 1440 строк в сутки, в которых
            // тонет всё остальное. Печатаем только ВОЗВРАТ к здоровью после сбоя.
            if (this.lastHealthy === false) {
                console.log(`[${new Date().toISOString()}] Health check passed — восстановился`);
            }
            this.failedChecks = 0;
        }
        this.lastHealthy = isHealthy;

        // Дополнительная проверка при высоком CPU
        if (cpuUsage > CONFIG.CPU_THRESHOLD) {
            console.log(`[${new Date().toISOString()}] High CPU usage detected: ${cpuUsage}%`);
        }

        this.reportSummary();
    }

    /** Часовая сводка — доказательство, что сторож жив, вместо поминутного «passed». */
    private reportSummary(): void {
        const now = Date.now();
        if (!this.lastSummaryAt) this.lastSummaryAt = now;
        if (now - this.lastSummaryAt < CONFIG.SUMMARY_INTERVAL) return;
        console.log(
            `[${new Date().toISOString()}] Сводка за час: проверок ${this.ticks}, ` +
                `состояние ${this.lastHealthy ? 'здоров' : 'СБОЙ'}, максимум CPU ${this.maxCpu}%`,
        );
        this.lastSummaryAt = now;
        this.ticks = 0;
        this.maxCpu = 0;
    }

    start(): void {
        console.log(`[${new Date().toISOString()}] Watchdog started for ${CONFIG.APP_NAME}`);
        this.check(); // Первая проверка сразу
        setInterval(() => this.check(), CONFIG.CHECK_INTERVAL);
    }
}

// Запускаем watchdog
const watchdog = new Watchdog();
watchdog.start(); 