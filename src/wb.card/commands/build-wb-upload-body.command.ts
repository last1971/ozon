import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';

@Injectable()
export class BuildWbUploadBodyCommand implements ICommandAsync<IWbCreateCardContext> {
    async execute(context: IWbCreateCardContext): Promise<IWbCreateCardContext> {
        const description = stripHtml(context.description || '').slice(0, 2000);

        context.uploadBody = [
            {
                subjectID: context.subjectId,
                variants: [
                    {
                        brand: context.brand || '',
                        title: context.title || context.productName,
                        description,
                        vendorCode: context.offerId,
                        dimensions: {
                            length: round(context.ozonDepth / 10),
                            width: round(context.ozonWidth / 10),
                            height: round(context.ozonHeight / 10),
                            weightBrutto: round(context.ozonWeightGrams / 1000, 3),
                        },
                        sizes: [
                            {
                                techSize: '0',
                                wbSize: '',
                                price: 10000,
                                skus: context.barcodes || [],
                            },
                        ],
                        characteristics: context.characteristics || [],
                    },
                ],
            },
        ];

        return context;
    }
}

function stripHtml(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li>/gi, '- ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function round(value: number, decimals = 1): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}
