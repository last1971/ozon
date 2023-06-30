import { Inject, Injectable, Logger } from '@nestjs/common';
import { IInvoice } from '../interfaces/IInvoice';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdDatabase, FirebirdTransaction } from 'ts-firebird';
import { InvoiceCreateDto } from '../invoice/dto/invoice.create.dto';
import Firebird from 'node-firebird';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { TransactionDto } from '../posting/dto/transaction.dto';

@Injectable()
export class Trade2006InvoiceService implements IInvoice {
    private logger = new Logger(Trade2006InvoiceService.name);
    constructor(@Inject(FIREBIRD) private db: FirebirdDatabase, private configService: ConfigService) {}

    async create(invoice: InvoiceCreateDto): Promise<InvoiceDto> {
        const transaction = await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED);
        try {
            const firmId = this.configService.get<number>('FIRM_ID', 31);
            const staffId = this.configService.get<number>('STAFF_ID', 25);
            const number =
                ((
                    await transaction.query('SELECT MAX(NS) FROM S WHERE FIRM_ID = ? AND DATA > ?', [
                        firmId,
                        DateTime.now().startOf('year').toISODate(),
                    ])
                )[0].MAX || 0) + 1;
            await transaction.execute(
                'INSERT INTO S (POKUPATCODE, DATA, PRIM, NS, STATUS, FIRM_ID, STAFF_ID) VALUES (?, ?, ?, ?, 0, ?, ?)',
                [invoice.buyerId, invoice.date, invoice.remark, number, firmId, staffId],
            );
            const scode = (await transaction.query('SELECT GEN_ID(SCODE_GEN, 0) from rdb$database', []))[0].GEN_ID;
            for (const invoiceLine of invoice.invoiceLines) {
                await transaction.execute('INSERT INTO REALPRICE (SCODE, GOODSCODE, QUAN, PRICE) VALUES (?, ?, ?, ?)', [
                    scode,
                    invoiceLine.goodCode,
                    invoiceLine.quantity,
                    invoiceLine.price,
                ]);
            }
            await transaction.execute('UPDATE S SET STATUS = 3 WHERE SCODE = ?', [scode]);
            await transaction.commit();
            return { id: scode, status: 3, ...invoice };
        } catch (e) {
            this.logger.error(e.message);
            await transaction.rollback();
            return null;
        }
    }

    async isExists(remark: string): Promise<boolean> {
        const res = await this.db.query('SELECT SCODE FROM S WHERE PRIM = ?', [remark]);
        return res.length > 0;
    }
    async getByPosting(posting: PostingDto): Promise<InvoiceDto> {
        const res = await this.db.query('SELECT * FROM S WHERE PRIM = ?', [posting.posting_number]);
        return res.length > 0
            ? {
                  id: res[0].SCODE,
                  buyerId: res[0].POKUPATCODE,
                  date: new Date(res[0].DATA),
                  remark: res[0].PRIM,
                  status: res[0].STATUS,
              }
            : null;
    }
    async getByPostingNumbers(
        postingNumbers: string[],
        transaction: FirebirdTransaction = null,
    ): Promise<InvoiceDto[]> {
        const workingTransaction = transaction ?? (await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED));
        try {
            const invoices = await workingTransaction.query(
                `SELECT *
                 FROM S
                 WHERE PRIM IN (${'?'.repeat(postingNumbers.length).split('').join()})`,
                postingNumbers.map((postingNumber) => postingNumber),
            );
            if (!transaction) await workingTransaction.commit();
            return invoices.map(
                (invoice): InvoiceDto => ({
                    id: invoice.SCODE,
                    status: invoice.STATUS,
                    buyerId: invoice.POKUPATCODE,
                    date: invoice.DATA,
                    remark: invoice.PRIM,
                }),
            );
        } catch (e) {
            if (transaction) throw e;
            await workingTransaction.rollback();
        }
    }
    async updateByTransactions(transactions: TransactionDto[]): Promise<void> {
        const transaction = await this.db.transaction(Firebird.ISOLATION_READ_COMMITTED);
        try {
            const invoices = await transaction.query(
                `SELECT * FROM S WHERE PRIM IN (${'?'.repeat(transactions.length).split('').join()})`,
                transactions.map((t) => t.posting_number),
            );
            if (invoices.length !== transactions.length) {
                const delta = transactions.filter(
                    (t) => !invoices.find((invoice) => invoice.PRIM === t.posting_number),
                );
                throw new Error(`Not find ${delta.map((invoice) => invoice.posting_number).toString()}`);
            }
            await transaction.execute(
                `UPDATE S SET STATUS=0 WHERE SCODE IN (${'?'.repeat(transactions.length).split('').join()})`,
                invoices.map((invoice) => invoice.SCODE),
            );
            for (const invoice of invoices) {
                const lines = await transaction.query('SELECT * FROM REALPRICE WHERE SCODE = ?', [invoice.SCODE]);
                const newAmount = transactions.find((t) => t.posting_number === invoice.PRIM).amount;
                const oldAmount = lines.reduce((s, line) => s + parseFloat(line.SUMMAP), 0);
                for (const line of lines) {
                    await transaction.execute('UPDATE REALPRICE SET SUMMAP = ? WHERE REALPRICECODE = ?', [
                        (newAmount * parseFloat(line.SUMMAP)) / oldAmount,
                        line.REALPRICECODE,
                    ]);
                }
            }
            await transaction.execute(
                `UPDATE S SET STATUS=4 WHERE SCODE IN (${'?'.repeat(transactions.length).split('').join()})`,
                invoices.map((invoice) => invoice.SCODE),
            );
            for (const invoice of invoices) {
                const newAmount = transactions.find((t) => t.posting_number === invoice.PRIM).amount;
                await transaction.execute(
                    'UPDATE OR INSERT INTO SCHET (MONEYSCHET, NS, DATA, POKUPATCODE, SCODE) VALUES (?, ?, ?, ?,' +
                        ' ?) MATCHING (SCODE)',
                    [
                        newAmount,
                        invoice.NS,
                        new Date(),
                        this.configService.get<number>('BUYER_ID', 24416),
                        invoice.SCODE,
                    ],
                );
            }
            await transaction.commit();
        } catch (e) {
            this.logger.error(e.message);
            await transaction.rollback();
            return null;
        }
    }
    async pickupInvoice(invoice: InvoiceDto): Promise<void> {
        if (invoice.status === 3) {
            await this.db.execute('UPDATE PODBPOS SET QUANSHOP = QUANSHOPNEED WHERE SCODE = ?', [invoice.id]);
            this.logger.log(`Order ${invoice.remark} has been pickuped`);
        }
    }
}
