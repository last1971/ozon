/* AVITO_GOOD: мягкое отключение привязок объявлений, удалённых на Авито.
   База: magazin.fdb (192.168.22.10). Дата: 2026-08-27.

   Зачем: POST /stock-management/1/info на удалённый item_id отдаёт 400 и валит
   весь чанк из 10 — загрузка SKU падает целиком. Помеченные строки перестают
   попадать в выгрузку, данные (GOODSCODE/COEFF/COMMISSION) при этом сохраняются.

   Откат пометки: UPDATE AVITO_GOOD SET DISABLED = 0 WHERE ID = '...';
*/

ALTER TABLE AVITO_GOOD ADD DISABLED SMALLINT;
ALTER TABLE AVITO_GOOD ADD DISABLED_AT TIMESTAMP;
ALTER TABLE AVITO_GOOD ADD DISABLED_REASON VARCHAR(50);
COMMIT;

/* существующие строки — активны. NOT NULL не ставим: в Firebird добавление
   NOT NULL-колонки со значением по умолчанию не заполняет старые записи,
   поэтому в коде читаем через COALESCE(DISABLED, 0). */
UPDATE AVITO_GOOD SET DISABLED = 0 WHERE DISABLED IS NULL;
COMMIT;

/* Проверка: должно быть 398 строк, все с DISABLED = 0
SELECT COALESCE(DISABLED, 0) AS D, COUNT(*) FROM AVITO_GOOD GROUP BY 1;
*/
