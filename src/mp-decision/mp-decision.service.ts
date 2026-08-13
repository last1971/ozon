import { Injectable } from '@nestjs/common';
import {
    CLAIM_RETURN_STATES,
    CodeDecision,
    Decision,
    DecisionCode,
    DecisionInput,
    IN_TRANSIT_RETURN_STATES,
    Layer1Action,
    LOST_RETURN_STATES,
} from './mp-decision.types';

/**
 * Решающая таблица (Этап 3 плана FBS-выбытия) — ЧИСТАЯ функция состояния.
 *
 * Ничего не читает и ничего не меняет: на входе состояние события, счёта и кодов,
 * на выходе — что следовало бы сделать. Исполнителя у неё нет и на итерации 5
 * не будет: действия включаются итерациями 7 и 8, процедуры БД появляются на 6.
 * Исключение — отмены FBS: они включены вживую 10.08 отдельным кодом
 * (`order.service.ts` `cancelOrder`), и ветки отмен здесь обязаны совпадать
 * с ним слово в слово — по ним таблица не прогноз, а зеркало боевого поведения.
 *
 * Два слоя фиксируются независимо (решение владельца 2026-08-08): слой 1 — счёт,
 * без оглядки на коды; слой 2 — коды, побочно. Дефолт обоих слоёв — ПИСЬМО,
 * а не молчание: гарды процедур пропускают только узкий набор состояний, и код,
 * выведенный вручную или списанием, прошёл бы их вхолостую — «успешно обработано»,
 * а код навсегда остался бы выведенным.
 */
@Injectable()
export class MpDecisionService {
    decide(input: DecisionInput): Decision {
        const base = { layer2: [] as CodeDecision[], input };

        if (!input.invoice) {
            return {
                ...base,
                branch: 'invoice-not-found',
                layer1: 'none',
                ...this.notFoundLetter(input),
            };
        }

        if (input.kind === 'delivered') return this.decideDelivered(input);
        if (input.kind === 'cancel') return this.decideCancel(input);
        return this.decideReturn(input);
    }

    /**
     * Счёта нет — писать или молчать.
     *
     * На ОТМЕНЕ молчим: счёта нет и не было. Счета заводит крон по заказам в работе
     * (`awaiting_packaging`) за узкое окно, а отмены вычитываются окном в 90 дней —
     * система по построению видит отмены заказов, которых никогда не заводила.
     * Замер на проде 10.08: из 349 отмен FBO без счёта 59, и доля ровная по месяцам
     * (14/22/18/5), а не хвост старых; у FBS то же самое — обе отмены без счёта
     * оказались `cancelled_after_ship: false`, то есть заказ отменили быстрее, чем
     * пятиминутный крон успел завести счёт. Делать по такому событию нечего:
     * ни счёта, ни резерва, ни подборки, ни кодов. Письмо было бы чистым шумом
     * (~1 в сутки), а шум глушит те письма, ради которых всё затевалось.
     *
     * Пишем там, где ФИЗИКА уже случилась, а счёта у нас нет: доставлено (уехало
     * то, чего мы не заводили) или возврат едет назад по неизвестному заказу.
     * Заявочные статусы и возврат в пути сюда не входят — физики там нет.
     */
    private notFoundLetter(input: DecisionInput): { letter: boolean; reason: string } {
        const state = input.returnState ?? '';
        const physicalReturn =
            input.kind === 'return' && !CLAIM_RETURN_STATES.includes(state) && !IN_TRANSIT_RETURN_STATES.includes(state);
        if (input.kind === 'delivered' || physicalReturn) {
            return {
                letter: true,
                reason: 'счёта нет, а физика уже случилась — разобрать руками',
            };
        }
        return {
            letter: false,
            reason: 'счёта нет и не было — заказ отменён раньше, чем мы его завели; делать нечего',
        };
    }

    /** Доставлено: над счётом ничего — закрытие по комиссиям идёт своим путём. */
    private decideDelivered(input: DecisionInput): Decision {
        const invoice = input.invoice;
        // 0.71 % доставленных: заказ отменяли, счёт отдали в доноры, а отправление
        // всё-таки доставили — коды могли уехать миграцией на чужую продажу.
        if (invoice.cancelled) {
            return this.build(input, 'delivered/marked-invoice', 'none', true, `счёт помечен «${invoice.mark.trim()}»`);
        }
        return this.build(input, 'delivered/normal', 'none', false, 'закрытие по комиссиям идёт своим путём');
    }

    private decideCancel(input: DecisionInput): Decision {
        const invoice = input.invoice;

        // Гейт закрытого счёта сильнее всего остального (обе схемы): закрытая
        // продажа проведена и оплачена, откатывать её статусом нельзя.
        if (invoice.closed || invoice.status === 5) {
            return this.build(input, 'cancel/closed-invoice', 'none', true, `счёт закрыт (STATUS=${invoice.status})`);
        }
        if (invoice.cancelled) {
            return this.build(input, 'cancel/already-marked', 'none', false, 'счёт уже помечен отменой');
        }

        if (input.scheme === 'FBO') {
            // Решение владельца 2026-08-11: подобранный FBO-счёт при отмене ЖДЁТ
            // записи возврата — только она знает, куда поедет товар (лёг на склад
            // Ozon → донор, поехал к нам → приём). Донор немедленно — только для
            // неподобранного (недобор, товара за счётом нет).
            if (invoice.status === 4) {
                return this.build(
                    input,
                    'cancel-fbo/picked',
                    'none',
                    false,
                    'ждём запись возврата — она решит: склад Ozon → донор, к нам → приём',
                );
            }
            if (invoice.status === 3) {
                return this.build(
                    input,
                    'cancel-fbo/unpicked',
                    'make-donor',
                    false,
                    'недобор (подборки нет) — « отмена FBO» + STATUS=1 сразу',
                );
            }
            return this.build(input, 'cancel-fbo/status-unexpected', 'none', true, `состояние счёта вне набора: STATUS=${invoice.status}`);
        }

        // «Передано» — только по статусу отправления у Ozon, не по FINISH_PICKUP.
        // Проверка идёт РАНЬШЕ статусов 3/4 — как в бою: иначе отгруженная посылка
        // со STATUS=3 попала бы в отвязку кодов.
        if (input.transferred) {
            // Решение владельца 2026-08-11 (заменяет «донор сразу» от 10.08):
            // по отмене НЕЛЬЗЯ понять, куда поедет товар — знает только запись
            // возврата. Счёт не трогаем вовсе (пометка сломала бы обработку
            // возврата: он пропускает помеченные счета), ждём возврат.
            return this.build(
                input,
                'cancel-fbs/transferred',
                'none',
                false,
                'товар уехал к Ozon — ждём запись возврата: она решит, донор (ReturnedToOzon) или приём у нас (ReceivedBySeller)',
            );
        }
        if (invoice.status === 4) {
            return this.build(
                input,
                'cancel-fbs/picked',
                'cancel-fbs-picked',
                true,
                'собрано и лежит у нас — коды TT 3→0 (привязка остаётся), счёт « отмена» + STATUS=1, ' +
                    'кладовщику письмо: вскрыть посылку, расформировать счёт, отсканировать коды',
            );
        }
        if (invoice.status === 3) {
            return this.build(
                input,
                'cancel-fbs/in-pick',
                'cancel-fbs-unpicked',
                true,
                'кладовщик не начинал или в процессе — отвязать коды, снять подборку, ' +
                    'счёт → STATUS=0 + « отмена», кладовщику сообщение «положите товар на полку»',
            );
        }
        return this.build(input, 'cancel-fbs/status-unexpected', 'none', true, `состояние счёта вне набора: STATUS=${invoice.status}`);
    }

    private decideReturn(input: DecisionInput): Decision {
        const invoice = input.invoice;
        const state = input.returnState ?? 'unknown';

        // Заявочные статусы физики не имеют вовсе. Если их не отбрасывать, получится
        // «вернулось больше, чем заказано».
        if (CLAIM_RETURN_STATES.includes(state)) {
            return this.build(input, 'return/claim-state', 'none', false, `заявочный статус ${state} — физики нет`);
        }
        if (IN_TRANSIT_RETURN_STATES.includes(state)) {
            return this.build(input, 'return/in-transit', 'none', false, `возврат в пути (${state})`);
        }
        if (LOST_RETURN_STATES.includes(state)) {
            return this.build(input, 'return/lost', 'none', true, `товар до нас не доедет (${state})`);
        }
        // Частичность определяется только сравнением ЧИСЛА ЗАПИСЕЙ возврата с составом
        // отправления (по type не определяется: PartialReturn только у 2 из 8).
        // Автоматики под неё нет — 8 случаев за 180 дней дешевле разобрать письмом.
        if (input.partial) {
            return this.build(input, 'return/partial', 'none', true, 'вернулась часть состава отправления');
        }

        if (state === 'ReturnedToOzon') {
            const layer2 = this.decideCodesOnReturn(input, 'ReturnedToOzon');
            if (invoice.closed || invoice.status === 5) {
                // Шаги над КОДОМ выполняются (это состояние кода, счёта не касается),
                // а донора из закрытого счёта не делаем — ручной путь через MAKE_VOZVR.
                return this.build(
                    input,
                    'return/returned-to-ozon/closed-invoice',
                    'none',
                    true,
                    `счёт закрыт (STATUS=${invoice.status}) — донора не делаем, возврат оформляется руками`,
                    layer2,
                );
            }
            if (invoice.cancelled) {
                return this.build(
                    input,
                    'return/returned-to-ozon/already-donor',
                    'none',
                    false,
                    `счёт уже помечен «${invoice.mark.trim()}»`,
                    layer2,
                );
            }
            return this.build(
                input,
                'return/returned-to-ozon',
                'make-donor',
                false,
                'товар лёг на склад Ozon — счёт в доноры FBO-пула',
                layer2,
            );
        }

        if (state === 'ReceivedBySeller') {
            // Счёт уже расформирован (STATUS=0) — человек принял возврат до нас
            // (живой случай: хвост первого прогона поднял 5 давно разобранных).
            // Письмо тут — шум; коды при этом смотрим как обычно (слой 2 сам
            // зашумит, если на счёте что-то осталось).
            if (invoice.status === 0) {
                return this.build(
                    input,
                    'return/received-by-seller/already-received',
                    'none',
                    false,
                    'счёт уже расформирован — приём завершён до нас',
                    this.decideCodesOnReturn(input, 'ReceivedBySeller'),
                );
            }
            return this.build(
                input,
                'return/received-by-seller',
                'none',
                true,
                'товар приехал к нам — приём и расформирование руками (экран приёма возврата, итерация 9)',
                this.decideCodesOnReturn(input, 'ReceivedBySeller'),
            );
        }

        return this.build(input, 'return/unknown-state', 'none', true, `статус возврата вне набора: ${state}`);
    }

    /**
     * Ветки, где слой 1 говорит «событие уже отработано». Слой 2 в них молчит:
     * дефолт «письмо» здесь дал бы шум, а не сигнал — действия нет и быть не может,
     * а подвисший код на счёте-доноре и так виден в еженедельном отчёте.
     *
     * Ветка переходная: `already-marked` порождена СТАРЫМ поведением «донор
     * немедленно при ЛЮБОЙ отмене FBS». Теперь при отмене помечаются только
     * счета, лежащие у нас; отгруженные ждут возврата, поэтому после разбора
     * хвоста сюда будут попадать лишь настоящие повторы события.
     */
    private static readonly ALREADY_HANDLED = ['cancel/already-marked'];

    /** Слой 2 для событий отмены и доставки. */
    private decideCodes(input: DecisionInput, layer1: Layer1Action, branch: string): CodeDecision[] {
        return input.codes.map((code) => {
            if (MpDecisionService.ALREADY_HANDLED.includes(branch)) {
                return this.code(code, [], false, 'событие уже отработано — код не трогаем, висяк ловит недельный отчёт');
            }
            if (input.kind === 'delivered') return this.decideCodeOnDelivered(code);
            // Возвраты со своим слоем 2 (ReturnedToOzon, ReceivedBySeller) сюда не попадают —
            // у них layer2 посчитан отдельно. Остальные статусы возврата кодов не касаются:
            // товар либо не ехал, либо не доедет, и письмо по нему уже ушло слоем 1.
            if (input.kind === 'return') {
                return this.code(code, [], false, `по статусу возврата ${input.returnState} действий над кодом нет`);
            }
            if (input.scheme === 'FBO') {
                // НЕ трогаем TT: код обязан остаться TT=3 на доноре, иначе миграция
                // (TRANSFER_TYPE IN (2,3)) его не перенесёт на счёт FBO-продажи.
                return this.code(code, [], false, 'отмена FBO — TT не трогаем, код уезжает миграцией');
            }
            if (input.transferred) {
                // Отгруженная отмена ждёт записи возврата — код остаётся TT=3
                // на счёте до тех пор; висяк без возврата ловит недельный отчёт.
                return this.code(code, [], false, 'ждём запись возврата — код остаётся TT=3');
            }
            if (layer1 === 'make-donor') {
                // Код обязан остаться TT=3 на доноре — иначе миграция
                // (TRANSFER_TYPE IN (2,3)) его не перенесёт на FBO-продажу.
                return this.code(code, [], false, 'счёт в доноры — код остаётся TT=3, уедет миграцией на FBO-продажу');
            }
            if (layer1 === 'cancel-fbs-unpicked') {
                return code.transferType === 3
                    ? this.code(code, ['detach'], false, 'отвязать (MARKCODE_DETACH_FOR_FBS) — как кнопка «отвязать последний»')
                    : this.code(code, [], true, `состояние вне набора: TT=${code.transferType}, STATUS=${code.status}`);
            }
            if (layer1 === 'cancel-fbs-picked') {
                return code.transferType === 3 && code.status === 5
                    ? this.code(
                          code,
                          ['return-to-stock'],
                          false,
                          'TT 3→0 (MARKCODE_RETURN_TO_STOCK) — привязка остаётся, Дельфи потребует скан при расформировании',
                      )
                    : this.code(code, [], true, `состояние вне набора: TT=${code.transferType}, STATUS=${code.status}`);
            }
            return this.code(code, [], true, `действий не определено: TT=${code.transferType}, STATUS=${code.status}`);
        });
    }

    private decideCodeOnDelivered(code: DecisionCode): CodeDecision {
        if (code.transferType === 3 && code.status === 5) {
            return this.code(code, ['retire'], true, '5→6, RETIRE_REASON=1 + письмо на вывод из оборота (KM_FULL в письме)');
        }
        if (code.status === 6) {
            return this.code(code, [], false, 'код уже выведен — идемпотентность');
        }
        return this.code(code, [], true, `состояние вне набора: TT=${code.transferType}, STATUS=${code.status}`);
    }

    /**
     * Слой 2 на возврате. Шаг 6→5 идёт ПЕРВЫМ и раньше, чем слой 1 сделает счёт донором:
     * иначе код в состоянии 6 уедет миграцией на следующую FBO-продажу, гейт вывода
     * требует STATUS=5, и товар окажется продан дважды, а выведен один раз.
     */
    private decideCodesOnReturn(input: DecisionInput, state: 'ReturnedToOzon' | 'ReceivedBySeller'): CodeDecision[] {
        return input.codes.map((code) => {
            // TT=2 — код на балансе маркета в ГИС МТ. Поставить ему STATUS=5 у себя,
            // пока Ozon не оформил возвратный документ, значит развести базу с ГИС МТ.
            // Это корректировка УПД-2 в ЭДО, а не операция над кодом.
            if (code.transferType === 2) {
                return this.code(code, [], true, 'TT=2 — откат только корректировкой УПД-2 в ЭДО, руками');
            }
            if (code.status === 6 && code.retireReason !== 1) {
                return this.code(
                    code,
                    [],
                    true,
                    `вернулся товар с кодом, выведенным по причине ${code.retireReason ?? 'null'} — причина автоматике неизвестна`,
                );
            }
            if (state === 'ReturnedToOzon') {
                if (code.transferType === 3 && code.status === 6 && code.retireReason === 1) {
                    return this.code(code, ['unretire'], false, '6→5 (MARKCODE_FBS_UNSOLD) — до того, как счёт станет донором');
                }
                if (code.transferType === 3 && code.status === 5) {
                    return this.code(code, [], false, 'код уже в обороте');
                }
            } else {
                if (code.transferType === 3 && code.status === 6 && code.retireReason === 1) {
                    return this.code(
                        code,
                        ['unretire', 'return-to-stock'],
                        true,
                        '6→5, затем TT 3→0 (REALPRICECODE не трогаем) + письмо «изначально FBS»',
                    );
                }
                if (code.transferType === 3 && code.status === 5) {
                    return this.code(code, ['return-to-stock'], true, 'TT 3→0 (REALPRICECODE не трогаем) + письмо «изначально FBS»');
                }
            }
            return this.code(code, [], true, `состояние вне набора: TT=${code.transferType}, STATUS=${code.status}`);
        });
    }

    private code(code: DecisionCode, actions: CodeDecision['actions'], letter: boolean, note: string): CodeDecision {
        return { ki: code.ki, actions, letter, note, kmFull: code.kmFull };
    }

    private build(
        input: DecisionInput,
        branch: string,
        layer1: Layer1Action,
        letter: boolean,
        reason: string,
        layer2?: CodeDecision[],
    ): Decision {
        return {
            branch,
            layer1,
            letter,
            reason,
            layer2: layer2 ?? this.decideCodes(input, layer1, branch),
            input,
        };
    }
}
