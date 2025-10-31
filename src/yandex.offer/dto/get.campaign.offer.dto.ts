export class GetCampaignOfferDto {
    offerId: string;
    campaignPrice?: {
        vat?: number;
        updatedAt?: string;
    };
}
