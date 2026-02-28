import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FtpImageStorageProvider } from './ftp.image-storage.provider';
import { ImageStorageProviderName } from '../interfaces';

jest.mock('basic-ftp', () => ({
    Client: jest.fn().mockImplementation(() => ({
        access: jest.fn().mockResolvedValue(undefined),
        ensureDir: jest.fn().mockResolvedValue(undefined),
        uploadFrom: jest.fn().mockResolvedValue(undefined),
        close: jest.fn(),
    })),
}));

describe('FtpImageStorageProvider', () => {
    let provider: FtpImageStorageProvider;

    const mockConfigService = {
        get: jest.fn().mockImplementation((key: string, defaultVal?: string) => {
            const map: Record<string, string> = {
                FTP_HOST: 'ftp.example.com',
                FTP_USER: 'user',
                FTP_PASS: 'pass',
                FTP_PATH: '/images',
                IMAGE_BASE_URL: 'https://cdn.example.com/images',
            };
            return map[key] || defaultVal;
        }),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FtpImageStorageProvider,
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        provider = module.get<FtpImageStorageProvider>(FtpImageStorageProvider);
    });

    it('should be defined', () => {
        expect(provider).toBeDefined();
        expect(provider.name).toBe(ImageStorageProviderName.FTP);
    });

    it('should upload file and return URL', async () => {
        const buffer = Buffer.from('image data');
        const url = await provider.upload(buffer, 'photo.jpg');

        expect(url).toMatch(/^https:\/\/cdn\.example\.com\/images\/.*\.jpg$/);
    });

    it('should preserve file extension', async () => {
        const buffer = Buffer.from('image data');
        const url = await provider.upload(buffer, 'image.png');

        expect(url).toMatch(/\.png$/);
    });

    it('should default to .jpg when no extension', async () => {
        const buffer = Buffer.from('image data');
        const url = await provider.upload(buffer, 'noext');

        expect(url).toMatch(/\.jpg$/);
    });
});
