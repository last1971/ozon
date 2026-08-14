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
    clearOldFormed: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_WEEK,
            },
        },
        development: false,
    },
    enableOzonCampaigns: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_DAY_AT_6AM,
            },
        },
        development: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_HOUR,
            },
        },
    },
    checkOzonCampaigns: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_10_MINUTES,
            },
        },
        development: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_5_MINUTES,
            },
        },
    },
    processDiscountRequests: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_HOUR,
            },
        },  
        development: {
            enabled: false,
            settings: {
                time: CronExpression.EVERY_MINUTE,
            },
        },
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
    /**
     * Сдвинут на +2 мин от observeFbsWideWindow: оба крона кормят один runner
     * (общий буфер писем и потолок решений), одновременный старт — flush одного
     * забирает письма и сбрасывает потолок другого.
     */
    checkNewOrders: {
        production: {
            enabled: true,
            settings: {
                time: '0 2-57/5 * * * *',
            },
        },
        development: {
            enabled: false,
            settings: {
                time: '0 2-57/5 * * * *',
            },
        },
    },
    /**
     * Суточный прогон FBO: отмены (окно 90 дней) и доставка. Руками — GET /order/update-ozonfbo.
     * 04:03 — между пятиминутками (observe в :00/:05, checkNewOrders в :02/:07):
     * тоже кормит runner, стартовать с ними в одну секунду нельзя.
     */
    checkFboOrdersDaily: {
        production: {
            enabled: true,
            settings: {
                time: '0 3 4 * * *',
            },
        },
        development: false,
    },
    /**
     * Наблюдение за расширенным окном FBS (итерация 2): ничего не делает, только пишет в лог.
     * На dev выключено — кабинет и база там боевые, лишние запросы к Ozon не нужны.
     */
    observeFbsWideWindow: {
        production: {
            enabled: true,
            settings: {
                time: CronExpression.EVERY_5_MINUTES,
            },
        },
        development: false,
    },
    /**
     * Утренняя напоминалка «коды ЧЗ ждут передачи» — до рабочего дня,
     * чтобы выгрузка в ГИС МТ была первой задачей утра. На магазине кодов
     * нет (MARK_CODES_ENABLED) — сервис сам молчит, крону это не мешает.
     */
    chzReminder: {
        production: {
            enabled: true,
            settings: {
                time: '0 30 7 * * *',
            },
        },
        development: false,
    },
    /**
     * Еженедельный отчёт «подвисшие коды» (итерация 5): один SELECT плюс письмо.
     * На dev выключен — база там боевая, лишние письма не нужны.
     */
    weeklyStuckCodes: {
        production: {
            enabled: true,
            settings: {
                time: '0 0 8 * * 1',
            },
        },
        development: false,
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
