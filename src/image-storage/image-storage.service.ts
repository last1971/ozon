import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IImageStorage, ImageStorageProviderName } from './interfaces';
import { FtpImageStorageProvider } from './providers/ftp.image-storage.provider';

@Injectable()
export class ImageStorageService {
    private logger = new Logger(ImageStorageService.name);
    private providers: Map<ImageStorageProviderName, IImageStorage>;

    constructor(
        private configService: ConfigService,
        ftpProvider: FtpImageStorageProvider,
    ) {
        this.providers = new Map<ImageStorageProviderName, IImageStorage>([
            [ImageStorageProviderName.FTP, ftpProvider],
        ]);
    }

    async upload(file: Buffer, filename: string): Promise<string> {
        const providerName = this.configService.get<string>(
            'IMAGE_STORAGE_PROVIDER',
            'ftp',
        ) as ImageStorageProviderName;

        const provider = this.providers.get(providerName);
        if (!provider) {
            throw new Error(`Unknown image storage provider: ${providerName}`);
        }
        this.logger.log(`Uploading ${filename} via ${providerName}`);
        return provider.upload(file, filename);
    }
}
