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
    updateAllServicePrices: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_WEEK,
            },
        },
        development: false,
    },
    /*
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
    updateWbPrices: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_WEEK,
            },
        },
        development: false,
    },
     */
    checkGoodCount: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_MINUTE,
            },
        },
        development: {
            enabled: false,
            settings: {
                time: CronExpression.EVERY_10_SECONDS,
            },
        },
    },
    controlCheckGoodCount: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_6_HOURS,
            },
        },
        development: {
            enabled: false,
            settings: {
                time: CronExpression.EVERY_MINUTE,
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
                time: CronExpression.EVERY_5_MINUTES,
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
    checkCanceledFboOrders: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_HOUR,
            },
        },
        development: false,
    },
    checkCanceledOzonOrders: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_10_MINUTES,
            },
        },
        development: false,
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
        development: {
            enabled: false,
            settings: {
                time: CronExpression.EVERY_MINUTE,
            },
        },
    },
    checkHealth: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_3_HOURS,
            },
        },
        development: {
            enabled: false,
            settings: {
                time: CronExpression.EVERY_5_MINUTES,
            },
        },
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
