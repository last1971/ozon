import { SupplyDto } from '../supply/dto/supply.dto';

export interface ISuppliable {
    getSupplies(): Promise<SupplyDto[]>;
}
