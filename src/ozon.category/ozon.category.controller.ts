import { Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { OzonCategoryService, SearchResult, CommissionRange, CategoryAttributesResult } from './ozon.category.service';

@ApiTags('Ozon Category')
@Controller('ozon-category')
export class OzonCategoryController {
    constructor(private ozonCategoryService: OzonCategoryService) {}

    @Post('import-categories')
    @ApiOperation({ summary: 'Импорт категорий из Ozon API в БД' })
    async importCategories() {
        return this.ozonCategoryService.importCategories();
    }

    @Post('import-commissions')
    @ApiOperation({ summary: 'Импорт комиссий из XLSX файла' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                },
            },
        },
    })
    @UseInterceptors(FileInterceptor('file'))
    async importCommissions(@UploadedFile() file: Express.Multer.File) {
        return this.ozonCategoryService.importCommissions(file.buffer);
    }

    @Post('generate-embeddings')
    @ApiOperation({ summary: 'Генерация embeddings для типов без векторов' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                batchSize: {
                    type: 'number',
                    default: 100,
                    description: 'Размер батча для обработки',
                },
            },
        },
    })
    async generateEmbeddings(@Body('batchSize') batchSize?: number) {
        return this.ozonCategoryService.generateEmbeddings(batchSize);
    }

    @Get('search')
    @ApiOperation({ summary: 'Поиск похожих категорий по тексту (HNSW)' })
    @ApiQuery({ name: 'text', type: String, description: 'Текст для поиска' })
    @ApiQuery({ name: 'limit', type: Number, required: false, description: 'Количество результатов (по умолчанию 10)' })
    async searchSimilar(
        @Query('text') text: string,
        @Query('limit') limit?: number,
    ): Promise<SearchResult[]> {
        return this.ozonCategoryService.searchSimilar(text, limit || 10);
    }

    @Post('export-cache')
    @ApiOperation({ summary: 'Экспорт embeddings из БД в Redis (resumable)' })
    async exportCache() {
        return this.ozonCategoryService.exportToRedis();
    }

    @Post('rebuild-index')
    @ApiOperation({ summary: 'Пересобрать HNSW index из Redis' })
    async rebuildIndex() {
        return this.ozonCategoryService.rebuildIndex();
    }

    @Get('check-embedding')
    @ApiOperation({ summary: 'Проверить embedding по type_id' })
    @ApiQuery({ name: 'typeId', type: Number })
    async checkEmbedding(@Query('typeId') typeId: number) {
        return this.ozonCategoryService.checkEmbedding(Number(typeId));
    }

    @Get('attributes')
    @ApiOperation({ summary: 'Получить атрибуты категории (с фильтрацией и значениями словарей)' })
    @ApiQuery({ name: 'description_category_id', type: Number, description: 'ID категории описания' })
    @ApiQuery({ name: 'type_id', type: Number, description: 'ID типа товара' })
    async getAttributes(
        @Query('description_category_id') descriptionCategoryId: number,
        @Query('type_id') typeId: number,
    ): Promise<CategoryAttributesResult> {
        return this.ozonCategoryService.getCategoryAttributes(Number(descriptionCategoryId), Number(typeId));
    }

    @Get('commissions')
    @ApiOperation({ summary: 'Получить комиссии по type_id' })
    @ApiQuery({ name: 'typeId', type: Number, description: 'ID типа товара' })
    async getCommissions(@Query('typeId') typeId: number): Promise<{ fbo: CommissionRange[]; fbs: CommissionRange[] } | null> {
        return this.ozonCategoryService.getCommissions(Number(typeId));
    }
}
