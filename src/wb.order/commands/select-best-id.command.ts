import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbTransactionProcessingContext } from '../../interfaces/i.wb.transaction.processing.context';
import { countBy, maxBy } from 'lodash';

@Injectable()
export class SelectBestIdCommand implements ICommandAsync<IWbTransactionProcessingContext> {
  async execute(context: IWbTransactionProcessingContext): Promise<IWbTransactionProcessingContext> {
    if (!context.transactions || context.transactions.length === 0) {
      // Если транзакций нет, используем srid из sales
      if (context.srid) {
        return {
          ...context,
          selectedId: context.srid,
          selectedIdType: 'srid',
        };
      }
      return { ...context, stopChain: true };
    }

    // Подсчитываем assembly_id
    const assemblyIds = context.transactions
      .filter((t) => t.assembly_id && t.assembly_id !== 0)
      .map((t) => t.assembly_id.toString());

    if (assemblyIds.length > 0) {
      const assemblyIdCounts = countBy(assemblyIds);
      const mostFrequentAssemblyId = maxBy(
        Object.keys(assemblyIdCounts),
        (id) => assemblyIdCounts[id],
      );
      return {
        ...context,
        selectedId: mostFrequentAssemblyId,
        selectedIdType: 'assembly_id',
      };
    }

    // Если assembly_id нет или все 0, используем srid
    return {
      ...context,
      selectedId: context.srid,
      selectedIdType: 'srid',
    };
  }
}
