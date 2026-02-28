import { Module } from '@nestjs/common';
import { ImageStorageService } from './image-storage.service';
import { FtpImageStorageProvider } from './providers/ftp.image-storage.provider';

@Module({
    providers: [ImageStorageService, FtpImageStorageProvider],
    exports: [ImageStorageService],
})
export class ImageStorageModule {}
