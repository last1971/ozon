/**
 * Dry-run нового расчёта остатков для маркируемых товаров: НИЧЕГО не пишет ни в БД, ни на маркет.
 *
 * Считает по каждому торгуемому товару «как сейчас» (старая пропорция) и «как станет»
 * (свободные коды по номиналам), печатает дифф по фасовкам и отдельно эффект резерва.
 *
 * Запуск:  npx ts-node tools/marked-counts-dryrun.ts [--host 192.168.22.10] [--db /var/db/firebird/opt.fdb]
 */
import * as Firebird from 'node-firebird';
import { codesAfterOrders, distributeCodesToSkus, sumNominals } from '../src/helpers/good/mark-codes.distribution';
import { distributeGoodQuantities } from '../src/helpers/good/plain.distribution';
import { GoodDto } from '../src/good/dto/good.dto';

const arg = (name: string, fallback: string): string => {
    const index = process.argv.indexOf(`--${name}`);
    return index > -1 ? process.argv[index + 1] : fallback;
};

const options: Firebird.Options = {
    host: arg('host', '192.168.22.10'),
    port: Number(arg('port', '3050')),
    database: arg('db', '/var/db/firebird/opt.fdb'),
    user: arg('user', 'SYSDBA'),
    password: arg('password', '641767'),
    lowercase_keys: false,
    role: null,
    pageSize: 4096,
};

// Тот же фильтр, что в Trade2006GoodService.FREE_CODE_FILTER.
const FREE_CODE_FILTER =
    'm.STATUS = 5 AND m.TRANSFER_TYPE = 0 AND m.REALPRICECODE IS NULL AND m.REALPRICEFCODE IS NULL ' +
    'AND m.SHOPLOGCODE IS NULL AND m.SPISID IS NULL AND m.SPISSKLADCODE IS NULL AND m.SPISSHOPCODE IS NULL';

const attach = (): Promise<any> =>
    new Promise((resolve, reject) => Firebird.attach(options, (err, db) => (err ? reject(err) : resolve(db))));

const query = (db: any, sql: string, params: any[] = []): Promise<any[]> =>
    new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

type Row = { code: string; name: string; quantity: number; reserve: number };

const pad = (value: string | number, width: number): string => String(value).padEnd(width);

(async () => {
    const db = await attach();
    try {
        // Торгуемые маркируемые товары с остатком: только те, у кого есть строки в MARKCODES
        // (маркируемый без кодов остаётся на старой схеме — договорённость 8).
        const goods: Row[] = (
            await query(
                db,
                `SELECT g.GOODSCODE, n.NAME, s.QUAN,
                    (SELECT COALESCE(SUM(r.QUANSKLAD + r.QUANSHOP), 0) FROM RESERVEDPOS r WHERE r.GOODSCODE = g.GOODSCODE) AS RES
                 FROM (SELECT DISTINCT GOODSCODE FROM GOODS_CLASSIF WHERE MARK_REQUIRED = 1) g
                 JOIN SKLAD s ON s.GOODSCODE = g.GOODSCODE
                 JOIN GOODS gg ON gg.GOODSCODE = g.GOODSCODE
                 JOIN NAME n ON n.NAMECODE = gg.NAMECODE
                 WHERE EXISTS (SELECT 1 FROM OZON_PERC p WHERE p.GOODSCODE = g.GOODSCODE)
                   AND EXISTS (SELECT 1 FROM MARKCODES m WHERE m.GOODSCODE = g.GOODSCODE)`,
            )
        ).map((r) => ({
            code: String(r.GOODSCODE),
            name: String(r.NAME ?? '').trim(),
            quantity: Number(r.QUAN) || 0,
            reserve: Number(r.RES) || 0,
        }));

        console.log(`Торгуемых маркируемых товаров с кодами: ${goods.length}\n`);

        let changedGoods = 0;
        let piecesBefore = 0;
        let piecesAfter = 0;
        const reserveEffect: string[] = [];

        for (const good of goods) {
            // Фасовки маркета: PIECES=1 → базовый SKU, иначе `код-N`.
            const pieces: number[] = [
                ...new Set(
                    (await query(db, 'SELECT PIECES FROM OZON_PERC WHERE GOODSCODE = ?', [good.code])).map((p) =>
                        Number(p.PIECES),
                    ),
                ),
            ].sort((a, b) => a - b);
            const skus = pieces.map((p) => (p === 1 ? good.code : `${good.code}-${p}`));
            if (skus.length === 0) continue;

            const codeRows = await query(
                db,
                `SELECT COALESCE(m.QUANTITY, 1) AS NOMINAL, COUNT(*) AS CODES FROM MARKCODES m
                  WHERE ${FREE_CODE_FILTER} AND m.GOODSCODE = ?
                  GROUP BY COALESCE(m.QUANTITY, 1) ORDER BY 1`,
                [good.code],
            );
            const free = new Map<number, number>(codeRows.map((r) => [Number(r.NOMINAL), Number(r.CODES)]));

            // Резерв — построчно, заказами: склад закрывает каждый заказ своим кодом.
            const orders = (
                await query(
                    db,
                    'SELECT QUANSKLAD + QUANSHOP AS QUAN FROM RESERVEDPOS WHERE QUANSKLAD + QUANSHOP > 0 AND GOODSCODE = ?',
                    [good.code],
                )
            ).map((r) => Number(r.QUAN));

            const before = distributeGoodQuantities(skus, good as GoodDto);
            const afterReserve = codesAfterOrders(free, orders);
            const after = distributeCodesToSkus(good.code, skus, afterReserve);

            const diff = skus.filter((sku) => (before.get(sku) ?? 0) !== (after.get(sku) ?? 0));
            if (diff.length === 0) continue;
            changedGoods++;

            const codesText = Array.from(free.entries())
                .map(([nominal, count]) => `${nominal}×${count}`)
                .join(', ');
            console.log(`${pad(good.code, 8)} ${good.name}`);
            console.log(
                `  склад ${good.quantity}, резерв ${good.reserve}` +
                    (orders.length ? ` (заказы: ${orders.join(' + ')})` : '') +
                    `, свободные коды: ${codesText || 'нет'} (${sumNominals(free)} шт)`,
            );
            for (const sku of skus) {
                const wasCount = before.get(sku) ?? 0;
                const nowCount = after.get(sku) ?? 0;
                piecesBefore += wasCount;
                piecesAfter += nowCount;
                const mark = wasCount === nowCount ? ' ' : nowCount > wasCount ? '↑' : '↓';
                console.log(`   ${mark} ${pad(sku, 16)} ${pad(wasCount, 8)} → ${nowCount}`);
            }

            // Эффект резерва: сколько штук унесли подобранные коды сверх самих заказов.
            if (orders.length > 0) {
                const ordered = orders.reduce((sum, quantity) => sum + quantity, 0);
                const droppedPieces = sumNominals(free) - sumNominals(afterReserve);
                reserveEffect.push(
                    `${pad(good.code, 8)} заказы ${pad(orders.join('+'), 14)} → коды на ${droppedPieces} шт` +
                        (droppedPieces > ordered ? `  (+${droppedPieces - ordered} из-за неделимости кода)` : '  (ровно)'),
                );
            }

            // Расхождение кодов и учёта — данные, а не расчёт: считаем по кодам, но подсвечиваем.
            if (sumNominals(free) > good.quantity) {
                console.log(
                    `   ! кодов на ${sumNominals(free)} шт, на складе ${good.quantity} — расхождение ${
                        sumNominals(free) - good.quantity
                    } шт`,
                );
            }
            console.log('');
        }

        console.log('='.repeat(70));
        console.log(`Товаров с изменениями: ${changedGoods} из ${goods.length}`);
        console.log(`Суммарно по изменившимся фасовкам: было ${piecesBefore} → станет ${piecesAfter}`);
        if (reserveEffect.length) {
            console.log('\nЭффект резерва (код неделим):');
            reserveEffect.forEach((line) => console.log('  ' + line));
        }
    } finally {
        db.detach();
    }
})();
