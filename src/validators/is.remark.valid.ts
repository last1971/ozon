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

    /**
     * Через этот валидатор резолвятся все ручки `/pickup/:remark/*` — скан, подбор,
     * передача КМ, этикетка, FINISH_PICKUP. Раньше здесь был `getByPosting(remark, null, true)`,
     * то есть `CONTAINING` с `res[0]` без сортировки: номера отправлений не префикс-свободны
     * (расщеплённый заказ даёт …-0026-1 и …-0026-11), на проде 146 неоднозначных номеров
     * и 399 пар, из них в 30 короткий номер имеет больший SCODE. Кладовщик мог попасть
     * на чужой счёт. Теперь — точный предикат, он же отдаёт пометку отмены для гейтов.
     */
    async validate(remark: string, args: ValidationArguments) {
        const match = await this.invoiceService.findByPosting(remark, null);
        if (match) {
            const dto = args.object as RemarkDto;
            dto.invoice = match.invoice; // Сохраняем счет в объект DTO
            dto.match = match; // и пометку — гейты на скане и подборе смотрят сюда
            return true;
        }
        return false;
    }

    defaultMessage(args: ValidationArguments) {
        return 'Remark ($value) is not valid!';
    }
}
