import { UpdatePriceWithDiscountDto } from './update.price.with.discount.dto';

export class UpdateBusinessOfferPriceDto {
    offerId: string;
    price: UpdatePriceWithDiscountDto;
}
