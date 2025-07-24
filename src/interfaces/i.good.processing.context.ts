export interface IGoodsProcessingContext {
    skus: string[];
    ozonSkus?: string[];
    resultProcessingMessage?: string;
    logger?: { log: (msg: string) => void };
}