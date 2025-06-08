# AI Project Context / Архитектура проекта

## Технологии и стек
- **Backend:** NestJS (TypeScript)
- **Интеграции:** Ozon API, Wildberries (WB) API, Yandex API
- **Локальная база:** Firebird 2.5 (для хранения локальных товаров)
- **Vault:** Все ключи, токены, client_id, client_secret, URL и прочие чувствительные данные для API-интеграций хранятся только в Vault и получаются через VaultService

## Основные правила и подходы

- **Секреты и параметры API**  
  - Никогда не хранить client_id, client_secret, api_key, url и т.п. в .env, константах или файлах — только через VaultService.
  - Для каждого внешнего сервиса (Ozon, WB, Yandex) в Vault отдельный ключ.

- **Работа с внешними API**  
  - Для Ozon, WB, Yandex реализованы универсальные сервисы-клиенты (например, OzonApiService).
  - Все запросы к API должны идти через эти сервисы, с получением параметров из Vault.

- **Обработка ошибок**  
  - Использовать RxJS `.pipe(catchError(...))` для обработки ошибок в сервисах, возвращать объект вида `{ result, error }`.
  - Логировать ошибки через NestJS Logger.

- **Асинхронные данные**  
  - Не хранить асинхронно полученные данные (например, из Vault) в полях класса без гарантии инициализации.
  - Получать данные из Vault внутри каждого метода, либо реализовать надёжное кэширование.

- **Стиль кода**  
  - Форматирование через Prettier, настройки в `.prettierrc`.
  - Линтинг через ESLint, правила в `.eslintrc`.

## Пример использования VaultService

```typescript
const ozon = await this.vaultService.get('ozon');
const response = await this.httpService.post(
    ozon.PERFOMANCE_URL + '/api/client/token',
    { client_id: ozon.PERFOMANCE_CLIENT_ID, ... },
    { headers: { ... } }
);
```

## Пример обработки ошибок

```typescript
.pipe(
    catchError(async (error: AxiosError) => {
        this.logger.error(error.message + ' ' + error?.response?.data['message']);
        return {
            result: null,
            error: { service_message: error.message, message: error?.response?.data['message'] },
        };
    }),
)
```

## Прочее

- Все новые сервисы и интеграции должны соответствовать этим правилам.
- Если есть вопросы по архитектуре — смотри этот файл или спрашивай у автора. 