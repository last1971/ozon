export interface ICommandAsync<T> {
    execute(context: T): Promise<T>;
}