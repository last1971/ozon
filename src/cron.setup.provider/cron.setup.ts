import { CronExpression } from '@nestjs/schedule';

type EnvironmentSetup = {
    enabled: boolean;
    settings: {
        time: CronExpression | string;
    };
};
export type CronSetup = {
    production: boolean | EnvironmentSetup;
    development: boolean | EnvironmentSetup;
};

export const cronConfig: Record<string, CronSetup> = {
    updatePrices: {
        production: {
            enabled: false,
            settings: {
                time: CronExpression.EVERY_WEEK,
            },
        },
        development: false,
    },
    checkGoodCount: {
        production: {
            enabled: true,
            settings: {
                time: '0 0 9-19 * * 1-6',
            },
        },
        development: false,
    },
    checkNewOrders: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_5_MINUTES,
            },
        },
        development: false,
    },
    updateTransactions: {
        production: false,
        development: {
            enabled: true,
            settings: {
                time: '0 30 15 * * *',
            },
        },
    },
};
