import { Logger } from '@nestjs/common';
import { FirebirdTransaction } from 'ts-firebird';

// type Constructor = new (...args: any[]) => any;

export function WithTransactions<T extends new (...args: any[]) => {}>(Base: T) {
    return class extends Base {
        public async withTransaction<T>(
            operation: (transaction: FirebirdTransaction) => Promise<T>,
            existingTransaction?: FirebirdTransaction
        ): Promise<T> {
            // Используем this.pool и this.logger напрямую из класса
            const pool = this['pool'];
            const logger = this['logger'] || new Logger('Transaction');

            if (!pool) {
                throw new Error('Pool not found in class. Make sure you inject it with @Inject(FIREBIRD)');
            }

            const transaction = existingTransaction ?? await pool.getTransaction();
            try {
                const result = await operation(transaction);
                if (!existingTransaction) {
                    await transaction.commit(true);
                }
                return result;
            } catch (error) {
                logger.error(error.message);
                if (!existingTransaction) {
                    await transaction.rollback(true);
                }
                throw error;
            }
        }
    };
}