import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CONFIG = {
    APP_NAME: 'ozon',
    API_URL: 'http://localhost:3002/api',
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
            const response = await axios.get(CONFIG.API_URL, {
                timeout: 5000,
                validateStatus: (status) => status === 200
            });
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

        if (cpuUsage > CONFIG.CPU_THRESHOLD) {
            console.log(`[${new Date().toISOString()}] High CPU usage detected, checking health...`);
            const isHealthy = await this.checkHealth();

            if (!isHealthy) {
                this.failedChecks++;
                console.log(`[${new Date().toISOString()}] Health check failed (attempt ${this.failedChecks}/${CONFIG.MAX_RETRIES})`);

                if (this.failedChecks >= CONFIG.MAX_RETRIES) {
                    await this.restartApp();
                }
            } else {
                this.failedChecks = 0;
            }
        } else {
            // Сбрасываем счетчик неудачных проверок если CPU в норме
            this.failedChecks = 0;
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