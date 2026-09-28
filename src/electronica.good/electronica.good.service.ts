import { Injectable } from '@nestjs/common';
import { IGood } from '../interfaces/IGood';
import { GoodDto } from '../good/dto/good.dto';
import { ElectronicaApiService } from '../electronica.api/electronica.api.service';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import { ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { GoodWbDto } from '../good/dto/good.wb.dto';
import { WbCommissionDto } from '../wb.card/dto/wb.commission.dto';
import { FirebirdTransaction } from 'ts-firebird';
import { GoodServiceEnum } from '../good/good.service.enum';

@Injectable()
export class ElectronicaGoodService implements IGood {
    constructor(private api: ElectronicaApiService) {}

    generatePercentsForService(
        _service: IPriceUpdateable,
        _skus: string[],
        _goodPercentsDto?: Map<string, Partial<GoodPercentDto>>,
    ): Promise<GoodPercentDto[]> {
        throw new Error('Method not implemented.');
    }
    updatePercentsForService(
        _service: IPriceUpdateable,
        _skus: string[],
        _goodPercentsDto?: Map<string, Partial<GoodPercentDto>>,
    ): Promise<void> {
        throw new Error('Method not implemented.');
    }

    updateWbCategory(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    async in(codes: string[]): Promise<GoodDto[]> {
        const response = await this.api.method('/api/good', {
            page: 1,
            itemsPerPage: -1,
            with: ['retailStore'],
            filterAttributes: ['GOODSCODE'],
            filterOperators: ['IN'],
            filterValues: ['[' + codes.join() + ']'],
        });
        return response.data.map(
            (good: any): GoodDto => ({
                code: good.GOODSCODE,
                quantity: good.retailStore?.QUAN || 0,
                reserve: 0,
                name: '',
            }),
        );
    }
    async prices(_codes: string[]): Promise<GoodPriceDto[]> {
        return [];
    }
    async getPerc(_codes: string[]): Promise<GoodPercentDto[]> {
        return [];
    }
    async setPercents(_perc: GoodPercentDto): Promise<void> {}

    async getQuantities(_goodCodes: string[]): Promise<Map<string, number>> {
        return new Map<string, number>();
    }

    async updateCountForService(_service: ICountUpdateable, _args: any): Promise<number> {
        return 0;
    }

    updatePriceForService(_service: IPriceUpdateable, _skus: string[]): Promise<any> {
        return Promise.resolve(undefined);
    }

    getWbData(_ids: string[]): Promise<GoodWbDto[]> {
        return Promise.resolve([]);
    }

    setWbData(_data: GoodWbDto): Promise<void> {
        return Promise.resolve(undefined);
    }

    getWbCategoryByName(_name: string): Promise<WbCommissionDto> {
        return Promise.resolve(undefined);
    }
    async resetAvailablePrice(_goodCodes?: string[], _t?: FirebirdTransaction): Promise<void> {
        return Promise.resolve(undefined);
    }
    // Отключение товаров не поддерживается для Electronica (нет своей таблицы GOODS_DISABLED).
    async getDisabledCodes(_service: GoodServiceEnum, _t?: FirebirdTransaction): Promise<string[]> {
        return [];
    }
    async setGoodsDisabled(_codes: string[], _service: GoodServiceEnum, _t?: FirebirdTransaction): Promise<void> {
        return Promise.resolve(undefined);
    }
    async clearGoodsDisabled(_codes: string[], _service: GoodServiceEnum, _t?: FirebirdTransaction): Promise<void> {
        return Promise.resolve(undefined);
    }
    // Своей БД у Electronica нет — читаем без транзакции.
    async getTransaction(): Promise<FirebirdTransaction> {
        return null;
    }
    // Маркировки у Electronica нет — товары всегда считаются по старой схеме.
    async getMarkRequiredCodes(_t?: FirebirdTransaction): Promise<Set<string>> {
        return new Set<string>();
    }
    async getGoodsWithMarkCodes(_goodCodes: string[], _t?: FirebirdTransaction): Promise<Set<string>> {
        return new Set<string>();
    }
    async getFreeMarkCodesByNominal(
        _goodCodes: string[],
        _t?: FirebirdTransaction,
    ): Promise<Map<string, Map<number, number>>> {
        return new Map<string, Map<number, number>>();
    }
    async getReservedQuantities(_goodCodes: string[], _t?: FirebirdTransaction): Promise<Map<string, number[]>> {
        return new Map<string, number[]>();
    }
}
