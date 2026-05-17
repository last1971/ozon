import { Inject, Injectable } from '@nestjs/common';
import { FirebirdTransaction } from 'ts-firebird';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { FboShortageDto } from './dto/fbo-shortage.dto';

@Injectable()
export class FboMarkMigrationService {
    constructor(@Inject(INVOICE_SERVICE) private invoiceService: IInvoice) {}

    async migrate(
        products: ProductPostingDto[],
        newRpcs: number[],
        prims: string[],
        transaction: FirebirdTransaction,
    ): Promise<FboShortageDto[]> {
        const ss = this.invoiceService.getStorageSS();
        const shortages: FboShortageDto[] = [];

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            const gc = goodCode(product);
            let need = product.quantity * goodQuantityCoeff(product);
            const newRpc = newRpcs[i];
            const candidates = await this.invoiceService.findFboPodbposCandidates(gc, prims, transaction);

            for (const cand of candidates) {
                if (need === 0) break;
                const take = Math.min(cand.quanAvail, need);
                if (take === 0) continue;
                const codes = await this.invoiceService.getAttachedMarkCodesForMigration(
                    cand.realpricecode,
                    gc,
                    take,
                    transaction,
                );
                for (const { ki } of codes) {
                    await this.invoiceService.detachMarkCode(ki, cand.realpricecode, ss, transaction);
                }
                await this.invoiceService.decrementPodbpos(cand.podbposcode, take, transaction);
                for (const { ki } of codes) {
                    await this.invoiceService.reattachMarkCodeTransferred(ki, newRpc, gc, ss, transaction);
                }
                need -= take;
            }

            if (need > 0) shortages.push({ goodscode: gc, quantity: need });
        }

        return shortages;
    }
}
