SET SQL DIALECT 1;

/* Этап 4. Только подготовка структуры хранения статистики возвратов.
 * Firebird 2.5, совместимо с существующими базами SQL dialect 1.
 * Применять на каждой базе только по отдельному разрешению владельца.
 * На production — вместе с выкатом этапа 4, не раньше.
 * RETURN_PERC — доля от 0 до 1: 0.05 означает 5%.
 * NULL означает, что статистика ещё не рассчитана.
 * RETURN_PERC_AT — время последнего успешного расчёта.
 * Патч не заполняет статистику и не меняет наценки или цены.
 */
ALTER TABLE OZON_PERC ADD RETURN_PERC NUMERIC(9,6);
ALTER TABLE OZON_PERC ADD RETURN_PERC_AT TIMESTAMP;
ALTER TABLE OZON_PERC ADD CONSTRAINT CK_OZON_PERC_RETURN
    CHECK (RETURN_PERC IS NULL OR (RETURN_PERC >= 0 AND RETURN_PERC <= 1));
COMMIT;
