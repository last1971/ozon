import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from "class-validator";
import { Inject, Injectable } from "@nestjs/common";
import { IInvoice, INVOICE_SERVICE } from "../interfaces/IInvoice";
import { RemarkDto } from "../invoice/dto/remark.dto";

@ValidatorConstraint({ async: true })
@Injectable()
export class IsRemarkValid implements ValidatorConstraintInterface {
    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice, // Инжекция сервиса через токен
    ) {}

    async validate(remark: string, args: ValidationArguments) {
        // Логика проверки через сервис
        const invoice = await this.invoiceService.getByPosting(remark, null, true);
        if (invoice) {
            (args.object as RemarkDto).invoice = invoice; // Сохраняем счет в объект DTO
            return true;
        }
        // const res = await this.invoiceService.isExists(remark, null);
        return false;
    }

    defaultMessage(args: ValidationArguments) {
        return 'Remark ($value) is not valid!';
    }
}