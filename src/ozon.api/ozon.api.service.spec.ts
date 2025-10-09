import { Test, TestingModule } from '@nestjs/testing';
import { OzonApiService } from './ozon.api.service';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { VaultService } from 'vault-module/lib/vault.service';

describe('OzonApiService', () => {
    let service: OzonApiService;
    const post = jest.fn().mockReturnValue(of({ data: 'post' }));
    const get = jest.fn().mockReturnValue(of({ data: 'get' }));
    const vaultGet = jest.fn().mockResolvedValue({ URL: 'get', API_KEY: 'get', CLIENT_ID: 'get' });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OzonApiService,
                { provide: HttpService, useValue: { post, get } },
                { provide: VaultService, useValue: { get: vaultGet } },
            ],
        }).compile();

        service = module.get<OzonApiService>(OzonApiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test method with post', async () => {
        await service.method('test', { option: 'option ' });
        expect(vaultGet.mock.calls[0]).toEqual(['ozon']);
        expect(post.mock.calls[0]).toEqual([
            'gettest',
            { option: 'option ' },
            { headers: { 'Client-Id': 'get', 'Api-Key': 'get', 'Content-Type': 'application/json' } },
        ]);
    });

    it('test method with get', async () => {
        await service.method('test', { option: 'option ' }, 'get');
        expect(vaultGet.mock.calls[0]).toEqual(['ozon']);
        expect(get.mock.calls[0]).toEqual([
            'gettest',
            {
                params: { option: 'option ' },
                headers: { 'Client-Id': 'get', 'Api-Key': 'get', 'Content-Type': 'application/json' },
            },
        ]);
    });
});

describe('rawFetch', () => {
  let service: OzonApiService;
  let vaultService: any;
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(async () => {
    vaultService = { get: jest.fn().mockResolvedValue({ URL: 'http://api/', API_KEY: 'key', CLIENT_ID: 'id' }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OzonApiService,
        { provide: HttpService, useValue: {} },
        { provide: VaultService, useValue: vaultService },
      ],
    }).compile();
    service = module.get<OzonApiService>(OzonApiService);
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('should return parsed JSON on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{"foo": "bar"}')
    });
    const result = await service.rawFetch('/endpoint', { a: 1 });
    expect(result).toEqual({ foo: 'bar' });
  });

  it('should return text if JSON parse fails', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('not json')
    });
    const result = await service.rawFetch('/endpoint', { a: 1 });
    expect(result).toEqual('not json');
  });

  it('should throw error if response not ok', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'fail',
      text: () => Promise.resolve('error')
    });
    await expect(service.rawFetch('/endpoint', { a: 1 })).rejects.toThrow('Ozon API error: 500 fail');
  });

  it('should build fetchUrl and fetchOptions correctly for POST', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await service.rawFetch('/endpoint', { a: 1 }, 'POST');
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('http://api//endpoint');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Client-Id']).toBe('id');
    expect(call[1].headers['Api-Key']).toBe('key');
    expect(call[1].headers['Content-Type']).toBe('application/json');
    expect(call[1].body).toBe(JSON.stringify({ a: 1 }));
  });

  it('should build fetchUrl with query string for GET', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') });
    await service.rawFetch('/endpoint', { a: 1, b: 2 }, 'GET');
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain('/endpoint?');
    expect(call[1].method).toBe('GET');
    expect(call[1].headers['Client-Id']).toBe('id');
    expect(call[1].headers['Api-Key']).toBe('key');
    expect(call[1].headers['Content-Type']).toBe('application/json');
    expect(call[1].body).toBeUndefined();
  });
});
