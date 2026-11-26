import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BulkPriceRow, BulkPriceSource } from './bulk-price.context';

/** The market transition journal protects individual writes. This file remembers which
 * rows a catalog run has already checked when its worker is stopped or restarted. */
export function ozonBulkCheckpoint(directory = join(process.cwd(), 'data', 'bulk-prices')): BulkPriceSource['checkpoint'] {
    const cabinet = createHash('sha256').update(JSON.stringify([process.env.FB_HOST, process.env.FB_BASE, process.env.APP_PORT])).digest('hex');
    const path = join(directory, cabinet + '.json');
    return {
        async load() {
            try {
                const snapshot: { completed: boolean; rows: BulkPriceRow[] } = JSON.parse(await readFile(path, 'utf8'));
                return snapshot.completed ? [] : snapshot.rows;
            } catch (error) {
                if (error.code === 'ENOENT') return [];
                throw error;
            }
        },
        async save(rows, completed) {
            await mkdir(directory, { recursive: true });
            const temporary = path + '.' + randomUUID() + '.tmp';
            await writeFile(temporary, JSON.stringify({ completed, rows }), { mode: 0o600 });
            await rename(temporary, path);
        },
    };
}
