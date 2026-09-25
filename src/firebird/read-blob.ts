/**
 * Чтение BLOB-поля из строки ts-firebird: драйвер отдаёт не значение, а функцию,
 * которую надо дёрнуть с сырой транзакцией ((t as any).transaction) и собрать поток.
 * Одна на всех, кто читает BLOB (OZON_TYPES, WB_CATEGORIES) — второго чтения быть не должно.
 */
export function readBlob(blob: any, transaction: any, binary?: false): Promise<string>;
export function readBlob(blob: any, transaction: any, binary: true): Promise<Buffer | null>;
export function readBlob(blob: any, transaction: any, binary = false): Promise<string | Buffer | null> {
    return new Promise((resolve, reject) => {
        if (!blob || typeof blob !== 'function') {
            resolve(binary ? null : '');
            return;
        }
        blob(transaction, (err: any, _name: string, emitter: any) => {
            if (err) {
                reject(err);
                return;
            }
            const chunks: Buffer[] = [];
            emitter.on('data', (chunk: Buffer) => chunks.push(chunk));
            emitter.on('end', () => {
                const buf = Buffer.concat(chunks);
                resolve(binary ? buf : buf.toString('utf8'));
            });
            emitter.on('error', reject);
        });
    });
}
