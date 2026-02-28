import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ImageStorageService } from './image-storage.service';
import { ImageStorageProviderName } from './interfaces';
import { FtpImageStorageProvider } from './providers/ftp.image-storage.provider';

describe('ImageStorageService', () => {
    let service: ImageStorageService;

    const mockFtpProvider = {
        name: ImageStorageProviderName.FTP,
        upload: jest.fn().mockResolvedValue('https://cdn.example.com/images/test.jpg'),
    };

    const mockConfigService = {
        get: jest.fn().mockReturnValue('ftp'),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ImageStorageService,
                { provide: FtpImageStorageProvider, useValue: mockFtpProvider },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get<ImageStorageService>(ImageStorageService);
    });

    afterEach(() => jest.clearAllMocks());

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should upload via FTP provider', async () => {
        const buffer = Buffer.from('test');
        const url = await service.upload(buffer, 'test.jpg');

        expect(mockFtpProvider.upload).toHaveBeenCalledWith(buffer, 'test.jpg');
        expect(url).toBe('https://cdn.example.com/images/test.jpg');
    });

    it('should throw for unknown provider', async () => {
        mockConfigService.get.mockReturnValue('unknown');

        await expect(service.upload(Buffer.from('test'), 'test.jpg'))
            .rejects.toThrow('Unknown image storage provider: unknown');
    });
});
