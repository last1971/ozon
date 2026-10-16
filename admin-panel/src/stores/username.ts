/**
 * Имя кладовщика для документов (приём возвратов, пересортица) — одно на все экраны,
 * живёт в localStorage браузера: вводится один раз, дальше подставляется.
 */
const USER_KEY = 'mpReturns.username';

export const readUser = (): string => {
    try {
        return localStorage.getItem(USER_KEY) ?? '';
    } catch {
        return '';
    }
};

export const saveUser = (name: string): void => {
    try {
        localStorage.setItem(USER_KEY, name);
    } catch {
        // приватное окно или запрет хранения — имя живёт до перезагрузки
    }
};
