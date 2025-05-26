import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags, ApiParam } from '@nestjs/swagger';
import { PerformanceService } from './performance.service';

@ApiTags('Performance')
@Controller('performance')
export class PerformanceController {
    constructor(private readonly performanceService: PerformanceService) {}

    @ApiOperation({ summary: 'Get today money spent for campaigns' })
    @ApiQuery({ 
        name: 'campaignIds', 
        required: true,
        description: 'Comma separated campaign IDs',
        example: '123,456,789'
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Returns sum of money spent for today',
        type: Number
    })
    @Get('today-money-spent')
    async getTodayMoneySpent(@Query('campaignIds') campaignIds: string) {
        if (!campaignIds || campaignIds.trim() === '') {
            return this.performanceService.getTodayMoneySpent([]);
        }
        
        const ids = campaignIds.split(',')
            .map(id => id.trim())
            .filter(id => id !== '')
            .map(id => parseInt(id, 10))
            .filter(id => !isNaN(id));
            
        return this.performanceService.getTodayMoneySpent(ids);
    }

    @ApiOperation({ summary: 'Activate campaign' })
    @ApiParam({
        name: 'campaignId',
        required: true,
        description: 'Campaign ID to activate',
        type: Number,
        example: 123456
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Returns true if campaign was successfully activated',
        type: Boolean
    })
    @Post('campaign/:campaignId/activate')
    async activateCampaign(@Param('campaignId') campaignId: string) {
        const id = parseInt(campaignId, 10);
        if (isNaN(id)) {
            return false;
        }
        return this.performanceService.activateCampaign(id);
    }

    @ApiOperation({ summary: 'Deactivate campaign' })
    @ApiParam({
        name: 'campaignId',
        required: true,
        description: 'Campaign ID to deactivate',
        type: Number,
        example: 123456
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Returns true if campaign was successfully deactivated',
        type: Boolean
    })
    @Post('campaign/:campaignId/deactivate')
    async deactivateCampaign(@Param('campaignId') campaignId: string) {
        const id = parseInt(campaignId, 10);
        if (isNaN(id)) {
            return false;
        }
        return this.performanceService.deactivateCampaign(id);
    }
} 