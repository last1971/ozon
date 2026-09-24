import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JobService } from './job.service';
import { JobStateDto } from './job.state.dto';

@ApiTags('job')
@Controller('job')
export class JobController {
    constructor(private readonly jobs: JobService) {}

    @Get()
    @ApiOperation({ summary: 'Фоновые задачи: идущие и завершённые за последний час' })
    @ApiQuery({ name: 'kind', required: false, description: 'вид задачи: tnved-sync, tnved-missing…' })
    @ApiOkResponse({ type: [JobStateDto] })
    list(@Query('kind') kind?: string): JobStateDto[] {
        return this.jobs.list(kind || undefined);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Состояние одной задачи: фаза, прогресс, результат' })
    @ApiOkResponse({ type: JobStateDto })
    @ApiNotFoundResponse({ description: 'задачи нет: не запускалась, подчищена через час после конца или процесс перезапущен' })
    get(@Param('id') id: string): JobStateDto {
        const state = this.jobs.get(id);
        if (!state) throw new NotFoundException(`задача ${id} не найдена — запусти заново`);
        return state;
    }
}
