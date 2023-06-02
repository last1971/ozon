import { Inject, Injectable, Logger } from '@nestjs/common';
import { IInvoice } from '../interfaces/IInvoice';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdDatabase } from 'ts-firebird';
import { InvoiceCreateDto } from '../invoice/invoice.create.dto';
import Firebird from 'node-firebird';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class Trade2006InvoiceService implements IInvoice {
    private logger = new Logger(Trade2006InvoiceService.name);
    constructor(@Inject(FIREBIRD) private db: FirebirdDatabase, private configService: ConfigService) {}

    async create(invoice: InvoiceCreateDto): Promise<boolean> {
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
            await transaction.execute('UPDATE S SET STATUS = 4 WHERE SCODE = ?', [scode]);
            await transaction.commit();
            return true;
        } catch (e) {
            this.logger.error(e.message);
            await transaction.rollback();
            return false;
        }
    }

    async isExists(remark: string): Promise<boolean> {
        const res = await this.db.query('SELECT SCODE FROM S WHERE PRIM = ?', [remark]);
        return res.length > 0;
    }
}
