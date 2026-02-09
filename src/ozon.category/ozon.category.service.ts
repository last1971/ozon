import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdPool } from 'ts-firebird';
import { ProductService } from '../product/product.service';
import { AIService } from '../ai/ai.service';
import { Cache } from '@nestjs/cache-manager';
import Excel from 'exceljs';
import { HierarchicalNSW } from 'hnswlib-node';
import * as fs from 'fs';
import * as path from 'path';
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { CreateProductInput, IProductCreateContext } from './interfaces/product-create.context';
import { GenerateNameCommand } from './commands/generate-name.command';
import { FindCategoryCommand } from './commands/find-category.command';
import { LoadRequiredAttributesCommand } from './commands/load-required-attributes.command';
import { GenerateAttributeValuesCommand } from './commands/generate-attribute-values.command';
import { ResolveDictionaryValuesCommand } from './commands/resolve-dictionary-values.command';
import { ExpandVariantsCommand } from './commands/expand-variants.command';
import { ResolvePackagingCommand } from './commands/resolve-packaging.command';
import { BuildProductJsonCommand } from './commands/build-product-json.command';
import { SubmitProductCommand } from './commands/submit-product.command';
import { ValidateOfferIdCommand } from './commands/validate-offer-id.command';
import { OzonApiService } from '../ozon.api/ozon.api.service';

interface CategoryNode {
    description_category_id?: number;
    category_name?: string;
    type_id?: number;
    type_name?: string;
    disabled?: boolean;
    children?: CategoryNode[];
}

export interface CommissionRange {
    min: number;
    max: number | null;
    rate: number;
}

interface TypeRecord {
    TYPE_ID: number;
    TYPE_NAME: string;
    CATEGORY_PATH: string;
    EMBEDDING?: Buffer;
}

export interface SearchResult {
    typeId: number;
    typeName: string;
    categoryPath: string;
    similarity: number;
    fbsCommission: number | null;
}

export interface CategoryAttributeValue {
    id: number;
    value: string;
    info: string;
    picture: string;
}

export interface CategoryAttribute {
    id: number;
    name: string;
    description: string;
    type: string;
    is_required: boolean;
    is_collection: boolean;
    dictionary_id: number;
    attribute_complex_id: number;
    values: CategoryAttributeValue[];
    values_count?: number;
}

export interface CategoryAttributesResult {
    description_category_id: number;
    type_id: number;
    attributes: CategoryAttribute[];
}

const SKIP_ATTRIBUTE_IDS = new Set([
    4180, 4384, 4385, 8789, 8790, 9024, 9546, 10096,
    11254, 11650, 21837, 21841, 21845, 22232, 22270, 22273, 22390,
]);

const EMBEDDING_DIM = 1536;
const INDEX_PATH = path.join(process.cwd(), 'data', 'ozon_categories.hnsw');

const SUBSCRIPT_MAP: Record<string, string> = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

function sanitizeForWin1251(str: string): string {
    return str.replace(/[₀-₉]/g, (ch) => SUBSCRIPT_MAP[ch] || ch);
}

@Injectable()
export class OzonCategoryService implements OnModuleInit {
    private readonly logger = new Logger(OzonCategoryService.name);
    private index: HierarchicalNSW | null = null;
    private typeIdMap: Map<number, number> = new Map();
    private typeDataMap: Map<number, { typeName: string; categoryPath: string }> = new Map();

    private attrValuesLimit: number;

    constructor(
        @Inject(FIREBIRD) private pool: FirebirdPool,
        private productService: ProductService,
        private aiService: AIService,
        private cacheManager: Cache,
        private configService: ConfigService,
        private validateOfferIdCommand: ValidateOfferIdCommand,
        private generateNameCommand: GenerateNameCommand,
        private findCategoryCommand: FindCategoryCommand,
        private loadRequiredAttributesCommand: LoadRequiredAttributesCommand,
        private generateAttributeValuesCommand: GenerateAttributeValuesCommand,
        private resolveDictionaryValuesCommand: ResolveDictionaryValuesCommand,
        private expandVariantsCommand: ExpandVariantsCommand,
        private resolvePackagingCommand: ResolvePackagingCommand,
        private buildProductJsonCommand: BuildProductJsonCommand,
        private submitProductCommand: SubmitProductCommand,
        private ozonApiService: OzonApiService,
    ) {
        this.attrValuesLimit = this.configService.get<number>('ATTR_VALUES_LIMIT', 20);
    }

    async onModuleInit() {
        await this.loadIndex();
    }

    // ========== HNSW Index ==========

    private async loadIndex(): Promise<void> {
        try {
            if (fs.existsSync(INDEX_PATH)) {
                this.logger.log('Loading HNSW index from disk...');
                this.index = new HierarchicalNSW('cosine', EMBEDDING_DIM);
                await this.index.readIndex(INDEX_PATH);
                const types = await this.loadFromRedis();
                if (types.length > 0) {
                    this.populateTypeMaps(types);
                }
                this.logger.log(`HNSW index loaded: ${this.index.getCurrentCount()} vectors, ${types.length} type maps`);
            }
        } catch (error) {
            this.logger.error(`Failed to load index: ${error.message}`);
        }
    }

    private populateTypeMaps(types: TypeRecord[]): void {
        this.typeIdMap.clear();
        this.typeDataMap.clear();
        types.forEach((type, idx) => {
            this.typeIdMap.set(idx, type.TYPE_ID);
            this.typeDataMap.set(type.TYPE_ID, {
                typeName: type.TYPE_NAME,
                categoryPath: type.CATEGORY_PATH,
            });
        });
    }


    async rebuildIndex(): Promise<{ indexed: number }> {
        this.logger.log('Rebuilding HNSW index...');
        const types = await this.loadFromRedis();
        if (!types.length) throw new Error('No embeddings in Redis. Run POST /ozon-category/export-cache first.');

        this.logger.log(`Building index for ${types.length} vectors...`);
        this.index = new HierarchicalNSW('cosine', EMBEDDING_DIM);
        this.index.initIndex(types.length, 16, 200, 100);

        let added = 0;
        types.forEach((type, i) => {
            if (!type.EMBEDDING) return;
            this.index.addPoint(this.bufferToEmbedding(type.EMBEDDING), i);
            added++;
        });
        this.logger.log(`Added ${added} vectors to index`);
        this.populateTypeMaps(types);

        const dir = path.dirname(INDEX_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        await this.index.writeIndex(INDEX_PATH);

        this.logger.log(`HNSW index rebuilt and saved: ${added} vectors`);
        return { indexed: added };
    }

    async searchSimilar(text: string, limit = 10): Promise<SearchResult[]> {
        if (!this.index?.getCurrentCount()) {
            try {
                await this.rebuildIndex();
            } catch {
                return [];
            }
        }

        const embedding = await this.aiService.generateEmbedding(text);
        const { neighbors, distances } = this.index.searchKnn(embedding, limit);
        const results: SearchResult[] = [];

        for (let i = 0; i < neighbors.length; i++) {
            const typeId = this.typeIdMap.get(neighbors[i]);
            if (!typeId) continue;
            const data = this.typeDataMap.get(typeId);
            const commissions = await this.getCommissions(typeId);
            const maxFbs = commissions?.fbs.length
                ? Math.max(...commissions.fbs.map(r => r.rate))
                : null;
            results.push({
                typeId,
                typeName: data?.typeName || '',
                categoryPath: data?.categoryPath || '',
                similarity: 1 - distances[i],
                fbsCommission: maxFbs,
            });
        }

        return results;
    }

    async findByPath(inputPath: string): Promise<SearchResult | null> {
        const normalized = inputPath.replace(/\s*>\s*/g, ' -> ').toLowerCase();
        for (const [typeId, data] of this.typeDataMap) {
            if (data.categoryPath.toLowerCase() === normalized) {
                const commissions = await this.getCommissions(typeId);
                const maxFbs = commissions?.fbs.length
                    ? Math.max(...commissions.fbs.map(r => r.rate))
                    : null;
                return {
                    typeId,
                    typeName: data.typeName,
                    categoryPath: data.categoryPath,
                    similarity: 1,
                    fbsCommission: maxFbs,
                };
            }
        }
        // Фолбэк: поиск по последнему сегменту (type name)
        const lastSegment = inputPath.split(/\s*>\s*/).pop()?.trim().toLowerCase();
        if (lastSegment) {
            for (const [typeId, data] of this.typeDataMap) {
                if (data.typeName.toLowerCase() === lastSegment) {
                    const commissions = await this.getCommissions(typeId);
                    const maxFbs = commissions?.fbs.length
                        ? Math.max(...commissions.fbs.map(r => r.rate))
                        : null;
                    return {
                        typeId,
                        typeName: data.typeName,
                        categoryPath: data.categoryPath,
                        similarity: 1,
                        fbsCommission: maxFbs,
                    };
                }
            }
        }
        return null;
    }

    // ========== Redis Cache ==========

    async exportToRedis(): Promise<{ exported: number; total: number }> {
        const t0 = await this.pool.getTransaction();
        const allTypes = await t0.query(
            'SELECT TYPE_ID, TYPE_NAME, CATEGORY_PATH FROM OZON_TYPES WHERE EMBEDDING IS NOT NULL AND DISABLED = 0',
            [], true,
        );
        this.logger.log(`exportToRedis: ${allTypes.length} types with embeddings in DB`);

        const idsJson = await this.cacheManager.get<string>('ozon:emb:ids');
        const exportedIds = new Set<number>(idsJson ? JSON.parse(idsJson) : []);
        const toExport = allTypes.filter((r: any) => !exportedIds.has(r.TYPE_ID));

        this.logger.log(`exportToRedis: ${exportedIds.size} already in Redis, ${toExport.length} to export`);
        if (toExport.length === 0) return { exported: 0, total: exportedIds.size };

        let exported = 0;
        const batchSize = 500;
        for (let i = 0; i < toExport.length; i += batchSize) {
            const batch = toExport.slice(i, i + batchSize);
            const ids = batch.map((r: any) => r.TYPE_ID).join(',');
            const t = await this.pool.getTransaction();
            try {
                const rows = await t.query(
                    `SELECT TYPE_ID, EMBEDDING FROM OZON_TYPES WHERE TYPE_ID IN (${ids})`,
                    [], false,
                );
                const transaction = (t as any).transaction;

                for (let j = 0; j < rows.length; j++) {
                    const dbRow = rows[j];
                    if (!dbRow.EMBEDDING) continue;
                    const buf = await this.readBlob(dbRow.EMBEDDING, transaction, true);
                    if (!buf || buf.length !== 6144) continue;

                    const meta = batch.find((r: any) => r.TYPE_ID === dbRow.TYPE_ID);
                    await this.cacheManager.set(`ozon:emb:${dbRow.TYPE_ID}`, JSON.stringify({
                        name: meta.TYPE_NAME,
                        path: meta.CATEGORY_PATH,
                        emb: buf.toString('base64'),
                    }), 0);
                    exportedIds.add(dbRow.TYPE_ID);
                    exported++;
                    if ((j + 1) % 50 === 0) this.logger.log(`  batch ${Math.floor(i / batchSize) + 1}: ${j + 1}/${rows.length}`);
                }

                await t.commit(true);
                await this.cacheManager.set('ozon:emb:ids', JSON.stringify([...exportedIds]), 0);
                this.logger.log(`${exported}/${toExport.length}`);
            } catch (error) {
                try { await t.rollback(true); } catch {}
                this.logger.error(`Batch failed at ${i}: ${error.message}`);
                await this.cacheManager.set('ozon:emb:ids', JSON.stringify([...exportedIds]), 0);
                return { exported, total: exportedIds.size };
            }
        }

        await this.cacheManager.set('ozon:emb:ids', JSON.stringify([...exportedIds]), 0);
        return { exported, total: exportedIds.size };
    }

    private async loadFromRedis(): Promise<TypeRecord[]> {
        const idsJson = await this.cacheManager.get<string>('ozon:emb:ids');
        if (!idsJson) return [];

        const ids: number[] = JSON.parse(idsJson);
        this.logger.log(`Loading ${ids.length} embeddings from Redis...`);

        const results: TypeRecord[] = [];
        for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            const promises = batch.map(async (id) => {
                const data = await this.cacheManager.get<string>(`ozon:emb:${id}`);
                if (!data) return null;
                const parsed = JSON.parse(data);
                return {
                    TYPE_ID: id,
                    TYPE_NAME: parsed.name,
                    CATEGORY_PATH: parsed.path,
                    EMBEDDING: Buffer.from(parsed.emb, 'base64'),
                } as TypeRecord;
            });
            const batchResults = await Promise.all(promises);
            results.push(...batchResults.filter((r): r is TypeRecord => r !== null));
        }

        this.logger.log(`Loaded ${results.length} embeddings from Redis`);
        return results;
    }

    // ========== Import ==========

    async importCategories(): Promise<{ categories: number; types: number }> {
        this.logger.log('Fetching category tree from Ozon API...');
        const tree = await this.productService.getCategoryTree();
        if (!tree?.result) throw new Error('Failed to get category tree');
        this.logger.log(`Got ${tree.result.length} root categories`);

        const t = await this.pool.getTransaction();
        let categories = 0, types = 0;

        try {
            const process = async (node: CategoryNode, parentId: number | null, pathArr: string[]) => {
                if (node.description_category_id) {
                    await t.execute(
                        `UPDATE OR INSERT INTO OZON_CATEGORIES (CATEGORY_ID, PARENT_ID, CATEGORY_NAME, DISABLED)
                         VALUES (?, ?, ?, ?) MATCHING (CATEGORY_ID)`,
                        [node.description_category_id, parentId, sanitizeForWin1251(node.category_name || ''), node.disabled ? 1 : 0],
                        false,
                    );
                    categories++;
                    if (categories % 50 === 0) this.logger.log(`Categories: ${categories}`);
                    const newPath = [...pathArr, sanitizeForWin1251(node.category_name || '')];
                    for (const child of node.children || []) {
                        await process(child, node.description_category_id, newPath);
                    }
                } else if (node.type_id) {
                    await t.execute(
                        `UPDATE OR INSERT INTO OZON_TYPES (TYPE_ID, CATEGORY_ID, TYPE_NAME, CATEGORY_PATH, DISABLED)
                         VALUES (?, ?, ?, ?, ?) MATCHING (TYPE_ID)`,
                        [node.type_id, parentId, sanitizeForWin1251(node.type_name || ''), [...pathArr, sanitizeForWin1251(node.type_name || '')].join(' -> '), node.disabled ? 1 : 0],
                        false,
                    );
                    types++;
                    if (types % 500 === 0) this.logger.log(`Types: ${types}`);
                }
            };

            for (const root of tree.result) await process(root, null, []);
            await t.commit(true);
            this.logger.log(`Done! Imported ${categories} categories, ${types} types`);
        } catch (error) {
            await t.rollback(true);
            this.logger.error(`Import failed, rolled back: ${error.message}`);
            throw error;
        }

        return { categories, types };
    }

    async importCommissions(buffer: Buffer): Promise<{ updated: number }> {
        this.logger.log('Loading XLSX...');
        const workbook = new Excel.Workbook();
        await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

        const ranges = [
            { min: 0, max: 100 }, { min: 100, max: 300 }, { min: 300, max: 1500 },
            { min: 1500, max: 5000 }, { min: 5000, max: 10000 }, { min: 10000, max: null },
        ];
        const fboCol = [3, 4, 5, 6, 7, 8], fbsCol = [15, 16, 17, 18, 19, 20];
        const commissions = new Map<string, { fbo: CommissionRange[]; fbs: CommissionRange[] }>();

        workbook.worksheets[0].eachRow((row, num) => {
            if (num === 1) return;
            const name = row.getCell(2).value?.toString()?.trim()?.toLowerCase();
            if (!name) return;
            commissions.set(name, {
                fbo: ranges.map((r, i) => ({ ...r, rate: this.parsePercent(row.getCell(fboCol[i]).value) })),
                fbs: ranges.map((r, i) => ({ ...r, rate: this.parsePercent(row.getCell(fbsCol[i]).value) })),
            });
        });
        this.logger.log(`Parsed ${commissions.size} commission entries from XLSX`);

        const t = await this.pool.getTransaction();
        const types = await t.query('SELECT TYPE_ID, TYPE_NAME FROM OZON_TYPES', [], false);

        const updates: { typeId: number; fbo: string; fbs: string }[] = [];
        for (const type of types) {
            const c = commissions.get(type.TYPE_NAME?.toLowerCase());
            if (c) {
                updates.push({ typeId: type.TYPE_ID, fbo: JSON.stringify(c.fbo), fbs: JSON.stringify(c.fbs) });
            }
        }

        this.logger.log(`Found ${updates.length} matches to update`);

        // Batch по 100 UPDATE в одном EXECUTE BLOCK
        const batchSize = 100;
        for (let i = 0; i < updates.length; i += batchSize) {
            const batch = updates.slice(i, i + batchSize);
            let block = 'EXECUTE BLOCK AS BEGIN\n';
            for (const u of batch) {
                const fbo = u.fbo.replace(/'/g, "''");
                const fbs = u.fbs.replace(/'/g, "''");
                block += `UPDATE OZON_TYPES SET FBO_COMMISSIONS = '${fbo}', FBS_COMMISSIONS = '${fbs}' WHERE TYPE_ID = ${u.typeId};\n`;
            }
            block += 'END';
            await t.execute(block, [], false);

            if ((i + batchSize) % 1000 === 0 || i + batchSize >= updates.length) {
                this.logger.log(`Progress: ${Math.min(i + batchSize, updates.length)}/${updates.length}`);
            }
        }

        await t.commit(true);
        this.logger.log(`Done! Updated ${updates.length} types with commissions`);
        return { updated: updates.length };
    }

    // ========== Commissions ==========

    async getCommissions(typeId: number): Promise<{ fbo: CommissionRange[]; fbs: CommissionRange[] } | null> {
        const t = await this.pool.getTransaction();
        const transaction = (t as any).transaction;
        try {
            const [row] = await t.query('SELECT FBO_COMMISSIONS, FBS_COMMISSIONS FROM OZON_TYPES WHERE TYPE_ID = ?', [typeId], false);
            if (!row) {
                await t.commit(true);
                return null;
            }

            const fboStr = await this.readBlob(row.FBO_COMMISSIONS, transaction);
            const fbsStr = await this.readBlob(row.FBS_COMMISSIONS, transaction);

            await t.commit(true);

            return {
                fbo: fboStr.startsWith('[') ? JSON.parse(fboStr) : [],
                fbs: fbsStr.startsWith('[') ? JSON.parse(fbsStr) : [],
            };
        } catch (error) {
            await t.rollback(true);
            throw error;
        }
    }

    async getCommissionForPrice(typeId: number, price: number, scheme: 'fbo' | 'fbs' = 'fbs'): Promise<number | null> {
        const c = await this.getCommissions(typeId);
        if (!c) return null;
        const range = c[scheme].find(r => price >= r.min && (r.max === null || price < r.max));
        return range?.rate ?? null;
    }

    // ========== Embeddings ==========

    async generateEmbeddings(batchSize = 100): Promise<{ processed: number; errors: number }> {
        const dbBatchSize = 5; // 5 embeddings * ~12KB hex = ~60KB < 64KB лимит EXECUTE BLOCK
        const tr = await this.pool.getTransaction();
        try {
            const types = await tr.query(
                'SELECT TYPE_ID, TYPE_NAME, CATEGORY_PATH FROM OZON_TYPES WHERE EMBEDDING IS NULL AND DISABLED = 0',
                [], false,
            );

            const totalBatches = Math.ceil(types.length / batchSize);
            this.logger.log(`Found ${types.length} types without embeddings (${totalBatches} batches)`);

            let processed = 0, errors = 0;

            for (let i = 0; i < types.length; i += batchSize) {
                const batch = types.slice(i, i + batchSize);
                const batchNum = Math.floor(i / batchSize) + 1;
                try {
                    this.logger.log(`Batch ${batchNum}/${totalBatches}: generating embeddings for ${batch.length} texts...`);
                    const embeddings = await this.aiService.generateEmbeddings(batch.map((row: any) => row.CATEGORY_PATH));

                    // Пишем в БД порциями по dbBatchSize через EXECUTE BLOCK
                    for (let k = 0; k < batch.length; k += dbBatchSize) {
                        const dbBatch = batch.slice(k, k + dbBatchSize);
                        let block = 'EXECUTE BLOCK AS BEGIN\n';
                        for (let j = 0; j < dbBatch.length; j++) {
                            const hex = this.embeddingToBuffer(embeddings[k + j]).toString('hex').toUpperCase();
                            block += `UPDATE OZON_TYPES SET EMBEDDING = x'${hex}' WHERE TYPE_ID = ${dbBatch[j].TYPE_ID};\n`;
                        }
                        block += 'END';
                        await tr.execute(block, [], false);
                    }
                    // Сохраняем в Redis
                    const idsJson = await this.cacheManager.get<string>('ozon:emb:ids');
                    const exportedIds: number[] = idsJson ? JSON.parse(idsJson) : [];
                    for (let idx = 0; idx < batch.length; idx++) {
                        await this.cacheManager.set(`ozon:emb:${batch[idx].TYPE_ID}`, JSON.stringify({
                            name: batch[idx].TYPE_NAME,
                            path: batch[idx].CATEGORY_PATH,
                            emb: this.embeddingToBuffer(embeddings[idx]).toString('base64'),
                        }), 0);
                        exportedIds.push(batch[idx].TYPE_ID);
                    }
                    await this.cacheManager.set('ozon:emb:ids', JSON.stringify(exportedIds), 0);

                    processed += batch.length;

                    this.logger.log(`Batch ${batchNum}/${totalBatches}: done. Progress: ${processed}/${types.length} (${Math.round(processed / types.length * 100)}%)`);
                } catch (e) {
                    this.logger.error(`Batch ${batchNum} error: ${e.message}`);
                    errors += batch.length;
                }
            }
            await tr.commit(true);
            this.logger.log(`Done! Processed: ${processed}, Errors: ${errors}`);
            return { processed, errors };
        } catch (error) {
            await tr.rollback(true);
            throw error;
        }
    }

    async checkEmbedding(typeId: number): Promise<{ typeId: number; length: number; sample: number[] } | null> {
        const t = await this.pool.getTransaction();
        const transaction = (t as any).transaction;
        try {
            const [row] = await t.query('SELECT EMBEDDING FROM OZON_TYPES WHERE TYPE_ID = ?', [typeId], false);
            if (!row) { await t.commit(true); return null; }
            const buf = await this.readBlob(row.EMBEDDING, transaction, true);
            await t.commit(true);
            if (!buf) return null;
            const embedding = this.bufferToEmbedding(buf);
            return { typeId, length: embedding.length, sample: embedding.slice(0, 10) };
        } catch (error) {
            await t.rollback(true);
            throw error;
        }
    }

    // ========== Category Attributes ==========

    async getCategoryAttributes(desc_cat_id: number, type_id: number): Promise<CategoryAttributesResult> {
        this.logger.log(`getCategoryAttributes: desc_cat_id=${desc_cat_id}, type_id=${type_id}`);
        const resp = await this.productService.getCategoryAttributes(desc_cat_id, type_id);
        const filtered = (resp.result || []).filter((a: any) => !SKIP_ATTRIBUTE_IDS.has(a.id));
        this.logger.log(`getCategoryAttributes: ${resp.result?.length || 0} total, ${filtered.length} after filter`);

        const attributes: CategoryAttribute[] = [];
        for (const attr of filtered) {
            if (attr.dictionary_id > 0) {
                this.logger.log(`  Loading values for attr ${attr.id} "${attr.name}" (dict=${attr.dictionary_id})`);
            }
            const allValues: CategoryAttributeValue[] = attr.dictionary_id > 0
                ? await this.productService.getCategoryAttributeValues(attr.id, desc_cat_id, type_id)
                : [];
            const truncated = allValues.length > this.attrValuesLimit;
            const values = truncated ? [] : allValues;
            this.logger.log(`  attr ${attr.id} "${attr.name}": ${allValues.length} values${truncated ? ` (truncated, limit=${this.attrValuesLimit})` : ''}`);
            attributes.push({ ...attr, values, ...(truncated ? { values_count: allValues.length } : {}) });
        }

        this.logger.log(`getCategoryAttributes: done, ${attributes.length} attributes`);
        return { description_category_id: desc_cat_id, type_id, attributes };
    }

    // ========== Product Create ==========

    async createProduct(input: CreateProductInput): Promise<IProductCreateContext> {
        const chain = new CommandChainAsync<IProductCreateContext>([
            this.validateOfferIdCommand,
            this.generateNameCommand,
            this.findCategoryCommand,
            this.loadRequiredAttributesCommand,
            this.generateAttributeValuesCommand,
            this.resolveDictionaryValuesCommand,
            this.expandVariantsCommand,
            this.resolvePackagingCommand,
            this.buildProductJsonCommand,
            this.submitProductCommand,
        ]);
        return chain.execute({ input, logger: this.logger });
    }

    async getImportInfo(taskId: number): Promise<any> {
        return this.ozonApiService.method('/v1/product/import/info', { task_id: taskId });
    }

    // ========== Utils ==========

    private readBlob(blob: any, transaction: any, binary?: false): Promise<string>;
    private readBlob(blob: any, transaction: any, binary: true): Promise<Buffer | null>;
    private readBlob(blob: any, transaction: any, binary = false): Promise<string | Buffer | null> {
        return new Promise((resolve, reject) => {
            if (!blob || typeof blob !== 'function') {
                resolve(binary ? null : '');
                return;
            }
            blob(transaction, (err: any, _name: string, emitter: any) => {
                if (err) { reject(err); return; }
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

    private parsePercent(v: any): number {
        if (v == null) return 0;
        const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,%]/g, '.'));
        return isNaN(n) ? 0 : n > 1 ? n / 100 : n;
    }

    private embeddingToBuffer(e: number[]): Buffer {
        return Buffer.from(new Float32Array(e).buffer);
    }

    private bufferToEmbedding(b: Buffer): number[] {
        return Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4));
    }
}
