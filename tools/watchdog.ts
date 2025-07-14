import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';

// Загружаем переменные окружения из .env файла
dotenv.config();

const execAsync = promisify(exec);

const CONFIG = {
    APP_NAME: 'ozon',
    API_URL: `http://${process.env.APP_HOST || 'localhost'}:${process.env.APP_PORT || '3002'}/api`,
    CPU_THRESHOLD: 90,
    CHECK_INTERVAL: 60000, // 1 минута
    RESTART_DELAY: 5000,   // 5 секунд после рестарта
    MAX_RETRIES: 3,        // количество попыток проверки перед рестартом
};

class Watchdog {
    private lastRestartTime: number = 0;
    private failedChecks: number = 0;

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
        console.log(`[${new Date().toISOString()}] Current CPU usage: ${cpuUsage}%`);

        // Всегда проверяем health независимо от CPU
        const isHealthy = await this.checkHealth();

        if (!isHealthy) {
            this.failedChecks++;
            console.log(`[${new Date().toISOString()}] Health check failed (attempt ${this.failedChecks}/${CONFIG.MAX_RETRIES})`);

            if (this.failedChecks >= CONFIG.MAX_RETRIES) {
                await this.restartApp();
            }
        } else {
            console.log(`[${new Date().toISOString()}] Health check passed`);
            this.failedChecks = 0;
        }

        // Дополнительная проверка при высоком CPU
        if (cpuUsage > CONFIG.CPU_THRESHOLD) {
            console.log(`[${new Date().toISOString()}] High CPU usage detected: ${cpuUsage}%`);
        }
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