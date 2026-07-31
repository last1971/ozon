/** Аудит-запись цепочки FBO-миграции: с какого счёта/строки (донор) на какой счёт/строку (приёмник) переехал товар. */
export class FboMigrationLinkDto {
    posting: string;
    goodscode: string;
    quantity: number;
    donorScode: number;
    donorRpc: number;
    targetScode: number;
    targetRpc: number;
}
