import { Test, TestingModule } from '@nestjs/testing';
import { AvitoApiService } from './avito.api.service';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { of, throwError } from 'rxjs';

describe('AvitoApiService', () => {
  let service: AvitoApiService;

  const avitoConfig = {
    URL: 'https://api.avito.ru',
    CLIENT_ID: 'client-id',
    CLIENT_SECRET: 'client-secret',
  };

  // Minimal Axios-like response helpers
  const axiosOk = (data: any) => ({ data });
  const axiosError = (status: number, data: any = { message: 'err' }) => {
    const err: any = new Error(`status ${status}`);
    err.response = { status, data };
    return err;
  };

  let httpServiceMock: {
    get: jest.Mock;
    request: jest.Mock;
    post: jest.Mock;
  };

  let vaultServiceMock: { get: jest.Mock };

  beforeEach(async () => {
    httpServiceMock = {
      get: jest.fn(),
      request: jest.fn(),
      post: jest.fn(), // used for token fetch
    };

    vaultServiceMock = {
      get: jest.fn().mockResolvedValue(avitoConfig),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvitoApiService,
        { provide: HttpService, useValue: httpServiceMock },
        { provide: VaultService, useValue: vaultServiceMock },
      ],
    }).compile();

    service = module.get<AvitoApiService>(AvitoApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('request() succeeds without retry', async () => {
    // token fetch
    httpServiceMock.post.mockReturnValueOnce(of(axiosOk({ access_token: 't1', expires_in: 3600 })));
    // business request
    httpServiceMock.request.mockReturnValueOnce(of(axiosOk({ ok: true })));

    const res = await service.request('/some/path', { a: 1 }, 'post');
    expect(res).toEqual({ ok: true });

    expect(vaultServiceMock.get).toHaveBeenCalledWith('avito');
    expect(httpServiceMock.post).toHaveBeenCalledWith(
      'https://api.avito.ru/token',
      expect.any(String),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(httpServiceMock.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.avito.ru/some/path', method: 'post', data: { a: 1 }, headers: expect.any(Object) }),
    );
  });

  it('request() retries once on 401 then succeeds', async () => {
    // first token
    httpServiceMock.post.mockReturnValueOnce(of(axiosOk({ access_token: 't1', expires_in: 1 })));
    // first business call -> 401
    httpServiceMock.request.mockReturnValueOnce(throwError(() => axiosError(401)));
    // refresh token
    httpServiceMock.post.mockReturnValueOnce(of(axiosOk({ access_token: 't2', expires_in: 3600 })));
    // second business call -> success
    httpServiceMock.request.mockReturnValueOnce(of(axiosOk({ ok: 'after-retry' })));

    const res = await service.request('/retry/path', { b: 2 }, 'post');
    expect(res).toEqual({ ok: 'after-retry' });

    expect(httpServiceMock.request).toHaveBeenCalledTimes(2);
  });

  it('request() retries once on 401 then fails', async () => {
    // first token
    httpServiceMock.post.mockReturnValueOnce(of(axiosOk({ access_token: 't1', expires_in: 1 })));
    // first business call -> 401
    httpServiceMock.request.mockReturnValueOnce(throwError(() => axiosError(401)));
    // refresh token
    httpServiceMock.post.mockReturnValueOnce(of(axiosOk({ access_token: 't2', expires_in: 3600 })));
    // second business call -> still 401
    httpServiceMock.request.mockReturnValueOnce(throwError(() => axiosError(401)));

    await expect(service.request('/retry-fail', { c: 3 }, 'post')).rejects.toBeTruthy();
    expect(httpServiceMock.request).toHaveBeenCalledTimes(2);
  });
});
