import { Test, TestingModule } from '@nestjs/testing';
import { PostingService } from './posting.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { ProductService } from '../product/product.service';
import { DateTime } from 'luxon';
import { OzonApiService } from "../ozon.api/ozon.api.service";
import { CreateOrGetExemplarsCommand } from './commands/create-or-get-exemplars.command';
import { BuildExemplarsPayloadCommand } from './commands/build-exemplars-payload.command';
import { ValidateExemplarsCommand } from './commands/validate-exemplars.command';
import { SetAndConfirmExemplarsCommand } from './commands/set-and-confirm-exemplars.command';
import { ShipExemplarsCommand } from './commands/ship-exemplars.command';

describe('PostingService', () => {
    let service: PostingService;
    const create = jest.fn();
    const createInvoiceFromPostingDto = jest.fn();
    const commit = jest.fn();
    const getByPosting = jest.fn();
    const getInvoiceLines = jest.fn();
    const bulkSetStatus = jest.fn();
    const updatePrim = jest.fn();
    const ozonApiMethod = jest.fn();
    const getAttachedMarkCodesByScode = jest.fn();
    const getKmFullByKi = jest.fn();
    let markMigrationEnabled = false;
    let nodeEnv: string | undefined;
    const date = new Date();
    const postings = [
        {
            posting_number: '123',
            status: 'awaiting_packaging',
            in_process_at: date,
            products: [],
        },
        {
            posting_number: '321',
            status: 'awaiting_packaging',
            in_process_at: date,
            products: [{ price: '1.11', offer_id: '444', quantity: 2 }],
        },
    ];
    const orderList = jest.fn().mockResolvedValue({
        result: {
            postings,
        },
    });
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PostingService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        isExists: async (remark: string) => remark === '123',
                        create,
                        createInvoiceFromPostingDto,
                        getByPosting,
                        getInvoiceLines,
                        bulkSetStatus,
                        updatePrim,
                        getAttachedMarkCodesByScode,
                        getKmFullByKi,
                        getGtdByKi: async () => null,
                        getTransaction: () => ({ commit }),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string, def?: any) => {
                            if (key === 'OZON_BUYER_ID') return 24416;
                            if (key === 'MARK_CODES_ENABLED') return markMigrationEnabled;
                            if (key === 'NODE_ENV') return nodeEnv;
                            return def;
                        },
                    },
                },
                {
                    provide: ProductService,
                    useValue: { orderList },
                },
                {
                    provide: OzonApiService,
                    useValue: {
                        method: ozonApiMethod,
                    },
                },
                CreateOrGetExemplarsCommand,
                BuildExemplarsPayloadCommand,
                ValidateExemplarsCommand,
                SetAndConfirmExemplarsCommand,
                ShipExemplarsCommand,
            ],
        }).compile();

        orderList.mockClear();
        ozonApiMethod.mockClear();
        getByPosting.mockReset();
        getInvoiceLines.mockReset();
        getAttachedMarkCodesByScode.mockReset();
        getKmFullByKi.mockReset();
        markMigrationEnabled = false;
        nodeEnv = undefined;
        service = module.get<PostingService>(PostingService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test delivery list', async () => {
        const products = await service.listAwaitingDelivering();
        expect(products).toEqual(postings);
    });

    it('test packaging list', async () => {
        await service.listAwaitingPackaging();
        expect(orderList.mock.calls[0]).toEqual([
            {
                since: DateTime.now().minus({ day: 5 }).startOf('day').toJSDate(),
                to: DateTime.now().endOf('day').toJSDate(),
                status: 'awaiting_packaging',
            },
            100,
            0,
        ]);
    });

    it('test createInvoice', async () => {
        const posting = {
            posting_number: '321',
            status: 'string',
            in_process_at: date.toISOString(),
            products: [
                {
                    price: '1.11',
                    offer_id: '444',
                    quantity: 2,
                },
            ],
        };
        await service.createInvoice(posting, null);
        expect(createInvoiceFromPostingDto.mock.calls[0]).toEqual([24416, posting, null]);
    });

    it('test listReturns with pagination', async () => {
        const mockReturns = [
            { id: 1, posting_number: 'return-001', schema: 'Fbs', order_number: 'order-001' },
            { id: 2, posting_number: 'return-002', schema: 'Fbo', order_number: 'order-002' },
        ];

        ozonApiMethod.mockResolvedValueOnce({ returns: mockReturns, has_next: false });

        const result = await service.listReturns(7);

        expect(result).toEqual(mockReturns);
        expect(ozonApiMethod).toHaveBeenCalledWith('/v1/returns/list', {
            filter: {
                logistic_return_date: {
                    time_from: DateTime.now().minus({ days: 7 }).startOf('day').toISO(),
                    time_to: DateTime.now().endOf('day').toISO(),
                },
            },
            limit: 500,
            last_id: 0,
        });
    });

    describe('getByPostingNumber', () => {
        it('returns Ozon result when posting found', async () => {
            const posting = { posting_number: 'P-1', status: 'awaiting_packaging', in_process_at: date.toISOString(), products: [] };
            ozonApiMethod.mockResolvedValueOnce({ result: posting });

            const res = await service.getByPostingNumber('P-1');

            expect(res).toEqual(posting);
            expect(ozonApiMethod).toHaveBeenCalledWith('/v3/posting/fbs/get', { posting_number: 'P-1' });
            expect(getByPosting).not.toHaveBeenCalled();
        });

        it('returns null when Ozon empty and migration flag is OFF', async () => {
            ozonApiMethod.mockResolvedValueOnce({ result: null });

            const res = await service.getByPostingNumber('P-2');

            expect(res).toBeNull();
            expect(getByPosting).not.toHaveBeenCalled();
        });

        it('falls back to local invoice when Ozon empty and migration flag is ON', async () => {
            markMigrationEnabled = true;
            ozonApiMethod.mockResolvedValueOnce({ result: null });
            getByPosting.mockResolvedValueOnce({ id: 8341, status: 1, date: '2026-05-08' });
            getInvoiceLines.mockResolvedValueOnce([
                { goodCode: '531557', whereOrdered: '', price: '739.00', quantity: 1 },
                { goodCode: '999', whereOrdered: 'cluster-A', price: '100.00', quantity: 2 },
            ]);

            const res = await service.getByPostingNumber('FBS-MIG-TEST-A');

            expect(res).toEqual({
                posting_number: 'FBS-MIG-TEST-A',
                status: '1',
                in_process_at: '2026-05-08',
                products: [
                    { price: '739.00', offer_id: '531557', quantity: 1 },
                    { price: '100.00', offer_id: '999-cluster-A', quantity: 2 },
                ],
            });
            expect(getByPosting).toHaveBeenCalledWith('FBS-MIG-TEST-A', null);
        });

        it('returns null when Ozon empty, flag ON, but no local invoice', async () => {
            markMigrationEnabled = true;
            ozonApiMethod.mockResolvedValueOnce({ result: null });
            getByPosting.mockResolvedValueOnce(null);

            const res = await service.getByPostingNumber('FBS-UNKNOWN');

            expect(res).toBeNull();
            expect(getInvoiceLines).not.toHaveBeenCalled();
        });

        it('falls back when Ozon throws and migration flag is ON', async () => {
            markMigrationEnabled = true;
            ozonApiMethod.mockRejectedValueOnce(new Error('Ozon 404'));
            getByPosting.mockResolvedValueOnce({ id: 8341, status: 1, date: '2026-05-08' });
            getInvoiceLines.mockResolvedValueOnce([
                { goodCode: '531557', whereOrdered: '', price: '739.00', quantity: 1 },
            ]);

            const res = await service.getByPostingNumber('FBS-MIG-TEST-A');

            expect(res?.posting_number).toBe('FBS-MIG-TEST-A');
            expect(res?.products).toHaveLength(1);
        });

        it('rethrows when Ozon throws and migration flag is OFF', async () => {
            ozonApiMethod.mockRejectedValueOnce(new Error('Ozon 500'));

            await expect(service.getByPostingNumber('P-X')).rejects.toThrow('Ozon 500');
            expect(getByPosting).not.toHaveBeenCalled();
        });
    });

    it('test listReturns with multiple pages', async () => {
        const page1 = [{ id: 1, posting_number: 'return-001', schema: 'Fbs', order_number: 'order-001' }];
        const page2 = [{ id: 2, posting_number: 'return-002', schema: 'Fbo', order_number: 'order-002' }];

        ozonApiMethod
            .mockResolvedValueOnce({ returns: page1, has_next: true })
            .mockResolvedValueOnce({ returns: page2, has_next: false });

        const result = await service.listReturns(7);

        expect(result).toEqual([...page1, ...page2]);
        expect(ozonApiMethod).toHaveBeenCalledTimes(2);
        expect(ozonApiMethod).toHaveBeenNthCalledWith(2, '/v1/returns/list', {
            filter: {
                logistic_return_date: {
                    time_from: DateTime.now().minus({ days: 7 }).startOf('day').toISO(),
                    time_to: DateTime.now().endOf('day').toISO(),
                },
            },
            limit: 500,
            last_id: 1,
        });
    });

    describe('submitFbsMarkCodes', () => {
        const invoice = { id: 8341, remark: 'P-1', buyerId: 24416 } as any;
        // Ответ validate «всё валидно» — вставляется в моки между /v3 get и set.
        const VALIDATE_OK = {
            products: [{ product_id: 999, valid: true, exemplars: [{ valid: true, marks: [{ valid: true }] }] }],
        };

        it('возвращает ok=true если нет привязанных КМ', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([]);
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true });
            expect(ozonApiMethod).not.toHaveBeenCalled();
        });

        it('возвращает failed если все KM_FULL пусты', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce(null);
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed).toEqual([{ ki: 'KI-1', reason: 'KM_FULL пуст' }]);
            expect(ozonApiMethod).not.toHaveBeenCalled();
        });

        it('happy path: createOrGet → getMap → set → poll done → ship → ok=true', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL-MARK-1');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: true })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_available', products: [] })
                .mockResolvedValueOnce({ result: ['P-1'] });

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res).toEqual({ ok: true, shipped: true });
            expect(ozonApiMethod).toHaveBeenNthCalledWith(
                1,
                '/v6/fbs/posting/product/exemplar/create-or-get',
                { posting_number: 'P-1' },
            );
            expect(ozonApiMethod).toHaveBeenNthCalledWith(
                3,
                '/v5/fbs/posting/product/exemplar/validate',
                expect.objectContaining({ posting_number: 'P-1' }),
            );
            expect(ozonApiMethod).toHaveBeenNthCalledWith(
                4,
                '/v6/fbs/posting/product/exemplar/set',
                expect.objectContaining({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            exemplars: [
                                {
                                    exemplar_id: 111,
                                    marks: [{ mark: '01FULL-MARK-1', mark_type: 'mandatory_mark' }],
                                    gtd: '',
                                    is_gtd_absent: true,
                                    is_rnpt_absent: true,
                                },
                            ],
                        },
                    ],
                }),
            );
            // теперь флоу шипит после ship_available
            expect(ozonApiMethod).toHaveBeenCalledWith(
                '/v4/posting/fbs/ship',
                expect.objectContaining({
                    posting_number: 'P-1',
                    packages: [{ products: [{ product_id: 999, quantity: 1, exemplar_ids: [111] }] }],
                }),
            );
        });

        it('validate вернул ошибку → стоп до set (failedStep=validate, set/ship не зовём)', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({ result: { products: [{ offer_id: '531557', sku: 999 }] } })
                .mockResolvedValueOnce({
                    products: [
                        {
                            product_id: 999,
                            valid: false,
                            exemplars: [{ valid: false, errors: ['GTD_MUST_BE_SPECIFIED_FOR_PRODUCT_COUNTRY'] }],
                        },
                    ],
                });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failedStep).toBe('validate');
            expect(res.failed).toContainEqual({
                ki: '*',
                reason: 'product 999: GTD_MUST_BE_SPECIFIED_FOR_PRODUCT_COUNTRY',
            });
            expect(ozonApiMethod).not.toHaveBeenCalledWith('/v6/fbs/posting/product/exemplar/set', expect.anything());
            expect(ozonApiMethod).not.toHaveBeenCalledWith('/v4/posting/fbs/ship', expect.anything());
        });

        it('ship упал → failedStep=ship, goToOzon=true', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({ result: { products: [{ offer_id: '531557', sku: 999 }] } })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: true })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_available', products: [] })
                .mockRejectedValueOnce(new Error('ship boom'));
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failedStep).toBe('ship');
            expect(res.goToOzon).toBe(true);
        });

        it('количественный КМ (quantity>1) → failed с подсказкой про деление', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-50', goodscode: '531557', realpricecode: 1, quantity: 50 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL-MARK-50');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 50,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed[0].ki).toBe('KI-50');
            expect(res.failed[0].reason).toContain('поделите код');
        });

        it('createOrGet вернул пустой ответ → skipRetry=true', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod.mockResolvedValueOnce({ result: null, error: { message: 'Not found' } });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.skipRetry).toBe(true);
        });

        it('goodscode не найден в posting → failed запись', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: 'WRONG', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed).toContainEqual({ ki: 'KI-1', reason: 'goodscode WRONG не найден в posting' });
        });

        it('poll status=ship_not_available → ok=false', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: true })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_not_available', products: [] });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed).toContainEqual({
                ki: '*',
                reason: 'polling fail (last=ship_not_available)',
            });
        });

        it('set result=false, но exemplar/status все passed → ok=true (идемпотентно)', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: false })
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    status: 'update_available',
                    products: [
                        {
                            product_id: 999,
                            exemplars: [{ exemplar_id: 111, marks: [{ check_status: 'passed' }] }],
                        },
                    ],
                });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true });
            expect(ozonApiMethod).toHaveBeenNthCalledWith(
                5,
                '/v5/fbs/posting/product/exemplar/status',
                { posting_number: 'P-1' },
            );
        });

        it('set result=false и exemplar/status не passed → ok=false с причиной', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: false })
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    status: 'ship_not_available',
                    products: [
                        {
                            product_id: 999,
                            exemplars: [{ exemplar_id: 111, marks: [{ check_status: 'failed' }] }],
                        },
                    ],
                });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed).toContainEqual({
                ki: '*',
                reason: 'setExemplars result=false; status=ship_not_available',
            });
        });

        it('dry-run для FBS-MIG-* в development не вызывает Ozon', async () => {
            nodeEnv = 'development';
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            const res = await service.submitFbsMarkCodes({
                ...invoice,
                remark: 'FBS-MIG-TEST-A',
            });
            expect(res).toEqual({
                ok: true,
                dryRun: true,
                payload: {
                    posting_number: 'FBS-MIG-TEST-A',
                    marks: ['01FULL'],
                    failed: [],
                },
            });
            expect(ozonApiMethod).not.toHaveBeenCalled();
        });
    });
});
