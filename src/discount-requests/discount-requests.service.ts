import { Injectable } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { DiscountTaskListParamsDto } from './dto/discount-task-list-params.dto';
import { DiscountTaskListDto } from './dto/discount-task-list.dto';
import { DiscountTaskApproveDto, DiscountTaskApproveResultDto } from './dto/discount-task-approve.dto';
import { DiscountTaskDeclineDto, DiscountTaskDeclineResultDto } from './dto/discount-task-decline.dto';

@Injectable()
export class DiscountRequestsService {
    constructor(private ozonApiService: OzonApiService) {}

    async getDiscountTasks(params: DiscountTaskListParamsDto): Promise<DiscountTaskListDto> {
        const res = await this.ozonApiService.method('/v1/actions/discounts-task/list', params, 'post');
        return res.result;
    }

    async approveDiscountTask(params: DiscountTaskApproveDto): Promise<DiscountTaskApproveResultDto> {
        const res = await this.ozonApiService.method('/v1/actions/discounts-task/approve', params, 'post');
        return res;
    }

    async declineDiscountTask(params: DiscountTaskDeclineDto): Promise<DiscountTaskDeclineResultDto> {
        const res = await this.ozonApiService.method('/v1/actions/discounts-task/decline', params, 'post');
        return res;
    }
} 