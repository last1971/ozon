export enum ImageStorageProviderName {
    FTP = 'ftp',
}

export interface IImageStorage {
    readonly name: ImageStorageProviderName;
    upload(file: Buffer, filename: string): Promise<string>;
}
