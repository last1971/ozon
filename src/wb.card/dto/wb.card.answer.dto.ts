import { WbCardDto } from './wb.card.dto';
import { WbCardCursorDto } from './wb.card.cursor.dto';

export class WbCardAnswerDto {
    cards: WbCardDto[];
    cursor: WbCardCursorDto;
}
