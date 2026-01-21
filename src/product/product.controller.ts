import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ProductVisibilityInterface, ProductVisibilityValues, ProductVisibilityClass } from './product.visibility';
import { ProductService } from "./product.service";
import { UpdateAttributesBodyDto, UpdateAttributesResponseDto } from './dto/update.attributes.dto';

@ApiTags('product')
@Controller('product')
export class ProductController {
    constructor(private service: ProductService) {}
    @ApiOkResponse({
        description: 'Получить информацию о ценах товаров',
        type: ProductVisibilityClass,
    })
    @Get('visibility')
    visibility(): ProductVisibilityInterface {
        return ProductVisibilityValues;
    }
    @ApiOkResponse({
        description: 'Получить информацию о складах',
        type: 'example',
    })
    @Get('store')
    async store(): Promise<any> {
        return this.service.getStoreList();
    }

    @Post('attributes/update')
    async updateAttributes(@Body() body: UpdateAttributesBodyDto): Promise<UpdateAttributesResponseDto[]> {
        return this.service.updateAttributes(body);
    }

    @Get('task/:taskId')
    async getTaskInfo(@Param('taskId') taskId: string): Promise<any> {
        return this.service.getTaskInfo(parseInt(taskId, 10));
    }
}
