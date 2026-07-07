import { Inject, Injectable } from '@nestjs/common';
import { FirebirdTransaction } from 'ts-firebird';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { FboShortageDto } from './dto/fbo-shortage.dto';

@Injectable()
export class FboMarkMigrationService {
    constructor(@Inject(INVOICE_SERVICE) private invoiceService: IInvoice) {}

    // Коды при FBO-переезде НЕ трогаем: они уже ушли в УПД-2 (TT=2, retired).
    // Переезжает только количество в подборке (PODBPOS).
    async migrate(
        products: ProductPostingDto[],
        prims: string[],
        transaction: FirebirdTransaction,
    ): Promise<FboShortageDto[]> {
        const shortages: FboShortageDto[] = [];

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            const gc = goodCode(product);
            let need = product.quantity * goodQuantityCoeff(product);
            const candidates = await this.invoiceService.findFboPodbposCandidates(gc, prims, transaction);

            for (const cand of candidates) {
                if (need === 0) break;
                const take = Math.min(cand.quanAvail, need);
                if (take === 0) continue;
                await this.invoiceService.decrementPodbpos(cand.podbposcode, take, transaction);
                need -= take;
            }

            if (need > 0) shortages.push({ goodscode: gc, quantity: need });
        }

        return shortages;
    }
}
