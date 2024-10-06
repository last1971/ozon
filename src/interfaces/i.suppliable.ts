import { SupplyDto } from '../supply/dto/supply.dto';
import { SupplyPositionDto } from '../supply/dto/supply.position.dto';
import { IProductable } from './i.productable';

export interface ISuppliable {
    getSupplies(): Promise<SupplyDto[]>;
    getSupplyPositions(id: string, productable: IProductable): Promise<SupplyPositionDto[]>;
}
