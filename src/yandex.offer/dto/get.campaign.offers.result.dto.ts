import { ScrollingPagerDto } from './scrolling.pager.dto';
import { GetCampaignOfferDto } from './get.campaign.offer.dto';

export class GetCampaignOffersResultDto {
    paging: ScrollingPagerDto;
    offers: GetCampaignOfferDto[];
}
