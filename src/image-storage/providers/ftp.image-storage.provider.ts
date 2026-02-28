import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'basic-ftp';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { IImageStorage, ImageStorageProviderName } from '../interfaces';

@Injectable()
export class FtpImageStorageProvider implements IImageStorage {
    readonly name = ImageStorageProviderName.FTP;
    private logger = new Logger(FtpImageStorageProvider.name);

    constructor(private configService: ConfigService) {}

    async upload(file: Buffer, filename: string): Promise<string> {
        const host = this.configService.get<string>('FTP_HOST');
        const user = this.configService.get<string>('FTP_USER');
        const password = this.configService.get<string>('FTP_PASS');
        const remotePath = this.configService.get<string>('FTP_PATH', '/tmp/pdf');
        const baseUrl = this.configService.get<string>('IMAGE_BASE_URL');

        const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '.jpg';
        const uniqueName = `${randomUUID()}${ext}`;

        const client = new Client();
        try {
            await client.access({ host, user, password });
            await client.ensureDir(remotePath);
            const stream = Readable.from(file);
            await client.uploadFrom(stream, `${remotePath}/${uniqueName}`);
            this.logger.log(`Uploaded ${uniqueName} to FTP`);
            return `${baseUrl}/${uniqueName}`;
        } finally {
            client.close();
        }
    }
}
