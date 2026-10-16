import { Module } from '@nestjs/common';
import { InvoiceModule } from '../../invoice/invoice.module';
import { AllocateSpisCodeCommand } from './allocate-spis-code.command';
import { CreateSpisDocCommand } from './create-spis-doc.command';

/** Общие шаги документа списания для цепочек возвратов и пересортицы. */
@Module({
    imports: [InvoiceModule],
    providers: [AllocateSpisCodeCommand, CreateSpisDocCommand],
    exports: [AllocateSpisCodeCommand, CreateSpisDocCommand],
})
export class SpisModule {}
