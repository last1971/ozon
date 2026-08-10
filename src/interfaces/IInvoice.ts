import { InvoiceCreateDto } from '../invoice/dto/invoice.create.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { PostingDto } from '../posting/dto/posting.dto';
import { TransactionDto } from '../posting/dto/transaction.dto';
import { ResultDto } from '../helpers/dto/result.dto';
import { FirebirdTransaction } from 'ts-firebird';
import { InvoiceGetDto } from '../invoice/dto/invoice.get.dto';
import { InvoiceLineDto } from '../invoice/dto/invoice.line.dto';
import { InvoiceUpdateDto } from "../invoice/dto/invoice.update.dto";
import { GoodServiceEnum } from '../good/good.service.enum';
import { FboMigrationLinkDto } from '../posting.fbo/dto/fbo-migration-link.dto';
import { InvoiceMatchDto } from '../invoice/dto/invoice.match.dto';

export interface IInvoice {
    getTransaction(): Promise<FirebirdTransaction>;
    create(invoice: InvoiceCreateDto, t: FirebirdTransaction): Promise<InvoiceDto>;
    isExists(remark: string, t: FirebirdTransaction): Promise<boolean>;
    /** Счёт по номеру отправления вместе с пометкой (' отмена', ' отмена FBO', ' закрыт'). */
    findByPosting(posting: PostingDto | string, t: FirebirdTransaction): Promise<InvoiceMatchDto | null>;
    updatePrim(prim: string, newPrim: string, t: FirebirdTransaction): Promise<void>;
    getByPosting(posting: PostingDto | string, t: FirebirdTransaction, containing?: boolean): Promise<InvoiceDto>;
    getByPostingNumbers(postingNumbers: string[]): Promise<InvoiceDto[]>;
    getByBuyerAndStatus(buyerId: number, status: number, t: FirebirdTransaction): Promise<InvoiceDto[]>;
    updateByCommissions(commissions: Map<string, number>, t: FirebirdTransaction): Promise<ResultDto>;
    updateByTransactions(transactions: TransactionDto[], t: FirebirdTransaction): Promise<ResultDto>;
    pickupInvoice(invoice: InvoiceDto, t: FirebirdTransaction): Promise<void>;
    createInvoiceFromPostingDto(buyerId: number, posting: PostingDto, t: FirebirdTransaction): Promise<InvoiceDto>;
    logShortage(
        service: GoodServiceEnum,
        posting: string,
        goodscode: string,
        quantity: number,
        prim: string,
        transaction: FirebirdTransaction,
    ): Promise<void>;
    isInFboShortage(posting: string, transaction: FirebirdTransaction): Promise<boolean>;
    pickupFboUnlessShortage(invoice: InvoiceDto, transaction: FirebirdTransaction): Promise<void>;
    logMigrationLink(link: FboMigrationLinkDto, transaction: FirebirdTransaction): Promise<void>;
    findFboPodbposCandidates(
        goodscode: string,
        prims: string[],
        nominal: number,
        transaction: FirebirdTransaction,
    ): Promise<{ podbposcode: number; scode: number; realpricecode: number; quanAvail: number; prim: string; cntNom: number; cntLive: number; cntTt3: number }[]>;
    findFboPodbposDonor(
        goodscode: string,
        prims: string[],
        quantity: number,
        transaction: FirebirdTransaction,
    ): Promise<{ podbposcode: number; scode: number; realpricecode: number; quanAvail: number } | null>;
    decrementPodbpos(podbposcode: number, take: number, transaction: FirebirdTransaction): Promise<void>;
    findLiveMigratableCodes(
        realpricecode: number,
        nominal: number,
        transaction: FirebirdTransaction,
    ): Promise<{ ki: string }[]>;
    migrateMarkCode(
        ki: string,
        oldRpc: number,
        newRpc: number,
        gc: string,
        s_s: 0 | 1,
        transaction: FirebirdTransaction,
    ): Promise<void>;
    migratePodbpos(
        oldPodbposcode: number,
        newScode: number,
        newRpc: number,
        gc: string,
        take: number,
        transaction: FirebirdTransaction,
    ): Promise<void>;
    clearInvoiceReserve(scode: number, transaction: FirebirdTransaction): Promise<void>;
    attachMarkCodeForFbs(
        ki: string,
        rpc: number,
        gc: string,
        s_s: 0 | 1,
        km_full: string,
        transaction: FirebirdTransaction,
    ): Promise<void>;
    detachMarkCodeForFbs(
        ki: string,
        rpc: number,
        s_s: 0 | 1,
        transaction: FirebirdTransaction,
    ): Promise<void>;
    countFreeMarkCodesForGood(goodscode: string, transaction: FirebirdTransaction): Promise<number>;
    getMarkCodeInfoByKi(
        ki: string,
        transaction: FirebirdTransaction,
    ): Promise<{ goodscode: string; quantity: number } | null>;
    getKmFullByKi(ki: string, transaction: FirebirdTransaction): Promise<string | null>;
    getGtdByKi(ki: string, transaction: FirebirdTransaction): Promise<string | null>;
    getPickedPartiesGtdByScode(
        scode: number,
        transaction: FirebirdTransaction,
    ): Promise<{ realpricecode: number; goodscode: string; quantity: number; gtd: string | null }[]>;
    listFbsAwaitingShip(buyerId: number, transaction: FirebirdTransaction): Promise<InvoiceDto[]>;
    getAttachedMarkCodesByScode(
        scode: number,
        transaction: FirebirdTransaction,
    ): Promise<{ ki: string; goodscode: string; realpricecode: number; quantity: number }[]>;
    getRealpriceLinesByScode(
        scode: number,
        transaction: FirebirdTransaction,
    ): Promise<{ realpricecode: number; goodscode: string; quantity: number }[]>;
    /** Счёт подобран (PODBPOS.QUAN{attr} >= QUAN{attr}NEED по всем строкам) — после подбора отвязка КМ запрещена. */
    isPickedUp(invoice: InvoiceDto, transaction: FirebirdTransaction): Promise<boolean>;
    getStorageSS(): 0 | 1;
    findRealpriceCodes(scode: number, transaction: FirebirdTransaction): Promise<number[]>;
    getByDto(invoiceGetDto: InvoiceGetDto): Promise<InvoiceDto[]>;
    getInvoiceLines(invoice: InvoiceDto, transaction: FirebirdTransaction): Promise<InvoiceLineDto[]>;
    bulkSetStatus(invoices: InvoiceDto[], status: number, transaction: FirebirdTransaction): Promise<void>;
    update(invoice: InvoiceDto, invoiceUpdateDto: InvoiceUpdateDto, t?: FirebirdTransaction): Promise<boolean>;
    distributePaymentByUPD(updNumber: number, updDate: string, amount: number): Promise<ResultDto>;
}
export const INVOICE_SERVICE = 'INVOICE_SERVICE';
