import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PriceReviewService } from './price-review.service';
export class PreparePriceReviewDto {
    @IsString() @IsNotEmpty() @MaxLength(200) offerId: string;
}
export class SendPriceReviewDto {
    @IsString() @IsNotEmpty() @MaxLength(100) token: string;
}
@Controller('price/review')
export class PriceReviewController {
    constructor(private readonly reviews: PriceReviewService) {}
    @Post()
    @HttpCode(202)
    prepare(@Body() body: PreparePriceReviewDto, @Headers('x-client-id') clientId?: string) {
        return this.reviews.prepareReview(body.offerId, clientId);
    }
    @Post('send')
    @HttpCode(202)
    send(@Body() body: SendPriceReviewDto, @Headers('x-client-id') clientId?: string) {
        return this.reviews.sendReview(body.token, clientId);
    }
}
