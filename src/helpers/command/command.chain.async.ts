import { ICommandAsync } from 'src/interfaces/i.command.acync';

export class CommandChainAsync<T>  implements ICommandAsync<T>{
    constructor(private readonly commands: ICommandAsync<T>[]) {}

    async execute(context: T): Promise<T> {
        for (const command of this.commands) {
            context = await command.execute(context);
        }
        return context;
    }
}
