import axios from "axios";

const url = import.meta.env.VITE_URL;

/**
 * Метка браузера для фоновых задач (X-Client-Id): «моя / чужая» задача в /api/job.
 * Не защита — логина в админке нет. localStorage может быть недоступен (приват-режим) — тогда без метки.
 */
const CLIENT_ID_KEY = 'client-id';
export function clientId(): string | undefined {
    try {
        let id = localStorage.getItem(CLIENT_ID_KEY);
        if (!id) {
            id = crypto.randomUUID();
            localStorage.setItem(CLIENT_ID_KEY, id);
        }
        return id;
    } catch {
        return undefined;
    }
}

const instance = axios.create({
    baseURL: url,
});
instance.interceptors.request.use((config) => {
    const id = clientId();
    if (id) config.headers['X-Client-Id'] = id;
    return config;
});

export default instance;
