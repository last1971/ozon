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
    testYandex: {
        production: false,
        development: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_MINUTE,
            },
        },
    },
    updateOzonPrices: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_WEEK,
            },
        },
        development: false,
    },
    updateYandexPrices: {
        production: {
            enabled: true,
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
                time: CronExpression.EVERY_HOUR,
            },
        },
        development: {
            enabled: false,
            settings: {
                time: CronExpression.EVERY_5_MINUTES,
            },
        },
    },
    checkNewOrders: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_5_MINUTES,
            },
        },
        development: {
            enabled: false,
            settings: {
                time: CronExpression.EVERY_MINUTE,
            },
        },
    },
    updateTransactions: {
        production: false,
        development: {
            enabled: false,
            settings: {
                time: '0 30 15 * * *',
            },
        },
    },
    checkCanceledWbOrders: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_DAY_AT_MIDNIGHT,
            },
        },
        development: false,
    },
    checkFboWbOrders: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_DAY_AT_NOON,
            },
        },
        development: false,
    },
    testCase1: {
        production: false,
        development: false,
    },
    testCase2: {
        production: false,
        development: true,
    },
    testCase3: {
        production: false,
        development: {
            enabled: false,
            settings: {
                time: '0 30 15 * * *',
            },
        },
    },
    testCase4: {
        production: false,
        development: {
            enabled: true,
            settings: {
                time: '0 30 15 * * *',
            },
        },
    },
};
