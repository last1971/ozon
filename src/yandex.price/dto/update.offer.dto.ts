import { BasePriceDto } from './base.price.dto';

export class UpdateOfferDto {
    offerId: string;
    purchasePrice: BasePriceDto;
    additionalExpenses: BasePriceDto;
    cofinancePrice: BasePriceDto;
}
