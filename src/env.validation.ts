import { plainToInstance } from 'class-transformer';
import { IsEnum, IsIP, IsNumber, IsString, IsUrl, validateSync } from 'class-validator';

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

    @IsUrl()
    VAULT_URL: string;

    @IsString()
    VAULT_ROOT: string;

    @IsString()
    VAULT_USER: string;

    @IsString()
    VAULT_PASS: string;

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
    SUM_OBTAIN: number;

    @IsNumber()
    SUM_PACK: number;
}

export function configValidate(config: Record<string, unknown>) {
    const validatedConfig = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
    const errors = validateSync(validatedConfig, { skipMissingProperties: false });

    if (errors.length > 0) {
        throw new Error(errors.toString());
    }
    return validatedConfig;
}
