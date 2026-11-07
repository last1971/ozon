/* После 2026-11-06_mp_loss_stats.sql. Перенос только рассчитанных долей Ozon.
   Выполнить блок в одной транзакции. Старые поля остаются для сверки.
   Повторный запуск не дополняет и не перезаписывает уже созданный снимок Ozon.
   Старые строки с неположительным кодом/фасовкой остаются в OZON_PERC, не переносятся.
   Количества/период неизвестны: NULL, а не выдуманные нули.
   На проде применять только при отдельном согласовании переключения читателя/писателя.
*/
SET SQL DIALECT 1;
SET BAIL ON;
SET AUTODDL OFF;
SET TERM ^ ;
EXECUTE BLOCK AS
BEGIN
    IF (NOT EXISTS (SELECT 1 FROM MP_LOSS_STATE WHERE SERVICE = 'OZON')) THEN
    BEGIN
        INSERT INTO MP_LOSS_STATE (SERVICE, CALCULATED_AT, PRELIMINARY)
        SELECT 'OZON', MAX(RETURN_PERC_AT), 0
        FROM OZON_PERC WHERE RETURN_PERC_AT IS NOT NULL AND GOODSCODE > 0 AND PIECES > 0
        HAVING COUNT(*) > 0;

        INSERT INTO MP_LOSS_STATS
            (SERVICE, GOODSCODE, PIECES, APPLIED_RETURN_RATE, CALCULATED_AT, DATA_STATE)
        SELECT 'OZON', GOODSCODE, PIECES, RETURN_PERC, RETURN_PERC_AT, 'MIGRATED'
        FROM OZON_PERC WHERE RETURN_PERC_AT IS NOT NULL AND GOODSCODE > 0 AND PIECES > 0;
    END
END^
SET TERM ; ^
COMMIT;
