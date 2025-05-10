import { Logger } from '@nestjs/common';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { WithTransactions } from './transaction.mixin';

describe('WithTransactions', () => {
    let TestClass: any;
    let instance: any;
    let mockPool: jest.Mocked<FirebirdPool>;
    let mockTransaction: jest.Mocked<FirebirdTransaction>;
    let mockLogger: jest.Mocked<Logger>;

    beforeEach(() => {
        mockTransaction = {
            commit: jest.fn(),
            rollback: jest.fn(),
        } as any;

        mockPool = {
            getTransaction: jest.fn().mockResolvedValue(mockTransaction),
        } as any;

        mockLogger = {
            error: jest.fn(),
        } as any;

        // Создаем тестовый класс с нужными свойствами
        TestClass = WithTransactions(
            class {
                pool = mockPool;
                logger = mockLogger;
            }
        );

        instance = new TestClass();
    });

    it('должен успешно выполнить транзакцию', async () => {
        const operation = jest.fn().mockResolvedValue('result');

        const result = await instance.withTransaction(
            operation
        );

        expect(result).toBe('result');
        expect(mockTransaction.commit).toHaveBeenCalledWith(true);
        expect(mockTransaction.rollback).not.toHaveBeenCalled();
    });

    it('должен откатить транзакцию при ошибке', async () => {
        const error = new Error('test error');
        const operation = jest.fn().mockRejectedValue(error);

        await expect(
            instance.withTransaction(operation)
        ).rejects.toThrow(error);

        expect(mockTransaction.rollback).toHaveBeenCalledWith(true);
        expect(mockTransaction.commit).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith(error.message);
    });

    it('должен использовать существующую транзакцию', async () => {
        const existingTransaction = {
            commit: jest.fn(),
            rollback: jest.fn()
        } as any;

        const operation = jest.fn().mockResolvedValue('result');

        const result = await instance.withTransaction(
            operation,
            existingTransaction
        );

        expect(result).toBe('result');
        expect(existingTransaction.commit).not.toHaveBeenCalled();
        expect(existingTransaction.rollback).not.toHaveBeenCalled();
        expect(mockPool.getTransaction).not.toHaveBeenCalled();
    });
});