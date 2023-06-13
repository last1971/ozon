import { IOfferIdable } from '../../interfaces/IOfferIdable';

export class ProductPostingDto implements IOfferIdable {
    price: string;
    offer_id: string;
    quantity: number;
}
