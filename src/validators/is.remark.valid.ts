import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from "class-validator";
import { Inject, Injectable } from "@nestjs/common";
import { IInvoice, INVOICE_SERVICE } from "../interfaces/IInvoice";
import { ModuleRef } from "@nestjs/core";

@ValidatorConstraint({ async: true })
@Injectable()
export class IsRemarkValid implements ValidatorConstraintInterface {
    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice, // Инжекция сервиса через токен
    ) {}

    async validate(remark: string, args: ValidationArguments) {
        // Логика проверки через сервис
        const res = await this.invoiceService.isExists(remark, null);
        return !!res;
    }

    defaultMessage(args: ValidationArguments) {
        return 'Remark ($value) is not valid!';
    }
}