import { plainToInstance, Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIP, IsNumber, IsString, IsUrl, validateSync } from 'class-validator';
import { GoodServiceEnum } from './good/good.service.enum';

export enum Environment {
    Development = 'development',
    Production = 'production',
    Test = 'test',
    Provision = 'provision',
}

class EnvironmentVariables {
    @IsEnum(Environment)
    NODE_ENV: Environment = Environment.Development;

    @IsNumber()
    PORT: number;

    @IsString()
    GOOD_PROVIDER: string;

    @IsEnum(GoodServiceEnum, { each: true })
    @Transform((strings) => strings.value.split(','))
    SERVICES: GoodServiceEnum[];

    @IsIP()
    FB_HOST: string;

    @IsNumber()
    FB_PORT: number;

    @IsString()
    FB_BASE: string;

    @IsString()
    FB_USER: string;

    @IsString()
    FB_PASS: string;

    @IsString()
    FB_ENCD: string;

    @IsNumber()
    FB_MAX_POOL: number;

    @IsUrl()
    VAULT_URL: string;

    @IsString()
    VAULT_ROOT: string;

    @IsString()
    VAULT_USER: string;

    @IsString()
    VAULT_PASS: string;

    @IsString()
    MAIL_HOST: string;

    @IsString()
    MAIL_USER: string;

    @IsString()
    MAIL_PASSWORD: string;

    @IsEmail()
    MAIL_FROM: string;

    @IsEmail()
    MAIL_ADMIN: string;

    @IsEmail()
    MAIL_LAST: string;

    @IsEmail()
    MAIL_NICK: string;

    @IsNumber()
    PERC_MAX: number;

    @IsNumber()
    PERC_NOR: number;

    @IsNumber()
    PERC_MIN: number;

    @IsNumber()
    PERC_MIL: number;

    @IsNumber()
    PERC_EKV: number;

    @IsNumber()
    MIN_MIL: number;

    @IsNumber()
    SUM_OBTAIN: number;

    @IsNumber()
    SUM_PACK: number;

    @IsNumber()
    SUM_LABEL: number;

    @IsNumber()
    YANDEX_SUM_PACK: number;

    @IsNumber()
    YANDEX_MIN_MIL: number;

    @IsNumber()
    YANDEX_PERC_EKV: number;
}

export function configValidate(config: Record<string, unknown>) {
    const validatedConfig = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
    const errors = validateSync(validatedConfig, { skipMissingProperties: false });

    if (errors.length > 0) {
        throw new Error(errors.toString());
    }
    return validatedConfig;
}
