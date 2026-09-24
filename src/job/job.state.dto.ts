import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobProgress } from '../interfaces/i.job.context';

export type JobStatus = 'running' | 'done' | 'failed';

export class JobProgressDto implements JobProgress {
    @ApiPropertyOptional({ description: 'Текущая фаза (команда цепочки)' }) phase?: string;
    @ApiProperty() done: number;
    @ApiPropertyOptional() total?: number;
    @ApiProperty({ description: 'Счётчики по ходу: ok, toFix, ambiguous…' }) counters: Record<string, number>;
}

/** Состояние фоновой задачи. Один объект живёт от старта до подчистки, progress — ссылка на контекст. */
export class JobStateDto {
    @ApiProperty({ description: 'uuid запуска' }) id: string;
    @ApiProperty({ description: 'Вид задачи: tnved-sync, tnved-missing…' }) kind: string;
    @ApiProperty({ description: 'С чем запущена' }) params: Record<string, unknown>;
    @ApiPropertyOptional({ description: 'Метка браузера, откуда запущена (X-Client-Id). Не защита.' }) clientId?: string;
    @ApiProperty({ enum: ['running', 'done', 'failed'] }) status: JobStatus;
    @ApiProperty({ type: JobProgressDto }) progress: JobProgressDto;
    @ApiPropertyOptional({ description: 'Результат по завершении' }) result?: unknown;
    @ApiPropertyOptional({ description: 'Текст ошибки при failed' }) error?: string;
    @ApiProperty() startedAt: string;
    @ApiPropertyOptional() finishedAt?: string;
}
