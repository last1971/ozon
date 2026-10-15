import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export const RETURN_ACTIONS = ['return', 'return-writeoff', 'problem'] as const;
export type ReturnAction = (typeof RETURN_ACTIONS)[number];

/** Решение кладовщика по строке возврата. */
export class AcceptReturnDto {
    @ApiProperty({ enum: RETURN_ACTIONS, description: 'вернуть / вернуть и списать / проблема' })
    @IsIn(RETURN_ACTIONS as unknown as string[])
    action: ReturnAction;

    @ApiProperty({ description: 'Кто принимает (логина в админке нет) — пишется в подборку и журнал' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(80)
    username: string;

    @ApiPropertyOptional({ type: [String], description: 'Сырые сканы марок — разбор на бэке единой читалкой КМ' })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(500)
    @IsString({ each: true })
    scans?: string[];

    @ApiPropertyOptional({ description: 'Комментарий; для «проблемы» обязателен' })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    comment?: string;

    @ApiPropertyOptional({ description: 'Номер отправления — если возврат найден живьём и в журнале его ещё нет' })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    posting?: string;

    @ApiPropertyOptional({ description: 'Основание списания (OSN_SPIS.ID) — для «вернуть и списать»' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    osnSpisId?: number;
}

/** Списание ранее принятой строки возврата. */
export class WriteOffReturnDto {
    @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) username: string;
    @ApiProperty({ description: 'OSN_SPIS.ID' }) @Type(() => Number) @IsInt() osnSpisId: number;
    @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

export class ReturnActionResultDto {
    @ApiProperty() ok: boolean;
    @ApiProperty({ description: 'Что сделано — для строки статуса на экране' }) message: string;
}
