import { renderFlatsFromSpec } from '@seamsterly/flats';
import {
  CATEGORY_LABEL_RU,
  FIT_INTENT_LABEL_RU,
  type Category,
  type FitIntent,
} from '@seamsterly/kb';
import type { StyleSpec } from '@seamsterly/stylespec';

/**
 * Лист на просчёт (RFQ).
 *
 * Отдельный документ, а не раздел техпака, и это принципиально. Фабрике
 * на этапе просчёта не нужен весь пакет: ей нужно понять, берётся она
 * за заказ или нет, и назвать цену. Прислать двадцатистраничный техпак
 * в ответ на «сколько будет стоить» значит получить молчание — это ровно
 * тот случай, когда объём документа работает против отправителя.
 *
 * Что фабрика спрашивает первым (knowledge-base/07 §2): что за изделие,
 * из чего, сколько штук, каких размеров сколько, что с отделкой, кому
 * отвечать. Ровно это здесь и есть, на одном листе.
 *
 * Полный техпак прикладывается ПО ЗАПРОСУ — и упоминается на листе,
 * чтобы фабрика знала: документ готов, спрашивать не о чем.
 */

export interface RfqContact {
  name?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  company?: string | undefined;
}

export interface RfqOptions {
  contact?: RfqContact;
  /** Распределение тиража по размерам. Мы его не выдумываем. */
  sizeRatio?: Readonly<Record<string, number>> | undefined;
  /** Срок, к которому нужен ответ. Пусто — не указываем. */
  replyBy?: string | undefined;
  /**
   * Готовый вид переда, если чертёж в паке взят из библиотеки силуэтов.
   *
   * Без этого лист на просчёт рисовал бы параметрический вид, а пак —
   * библиотечный, и два документа об одном изделии выглядели бы по-разному.
   * Фабрика замечает такое первой: «а это точно та же вещь?»
   */
  flat?: { svg: string } | undefined;
  /**
   * Ссылка на полный техпак.
   *
   * Заменяет «пришлём по запросу» на «вот он»: запрос — это лишний шаг и
   * лишний день, а лист на просчёт от ссылки не толстеет.
   */
  packLink?: string | undefined;
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`,
  );

const num = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');

/** Ключевые особенности: то, что меняет цену и сроки. */
export function rfqHighlights(spec: StyleSpec): string[] {
  const out: string[] = [];

  for (const a of spec.artwork?.placements ?? []) {
    out.push(
      a.kind === 'allover'
        ? `сплошной раппорт, шаг ${num(a.size_cm.width.value)} см, ` +
            `${a.pattern?.path === 'roll' ? 'печать полотна до раскроя' : 'печать по панелям'}`
        : `нанесение: ${a.zone_label_ru.toLowerCase()}, ` +
            `${num(a.size_cm.width.value)}×${num(a.size_cm.height.value)} см, ` +
            `${a.technique_label_ru.toLowerCase()}`,
    );
  }

  // Узлы вне базового парка — самая частая причина отказа фабрики
  // (knowledge-base/07 §3). Молчать о них на просчёте значит получить
  // отказ на следующем шаге, потратив время обеих сторон.
  const special = (spec.construction?.nodes ?? []).filter((n) => n.requires_special_equipment);
  if (special.length) {
    out.push(
      `спецоборудование: ${special.map((n) => n.label_ru.toLowerCase()).join(', ')} — ` +
        `в документе есть замена под базовый парк`,
    );
  }

  const colorways = spec.bom?.colorways.length ?? 0;
  if (colorways > 1) out.push(`${colorways} цвета`);

  return out;
}

/** Строка размерного ряда: с раскладкой, если она задана, иначе честно без. */
export function rfqSizeLine(spec: StyleSpec, ratio?: Readonly<Record<string, number>>): string {
  if (!ratio || Object.keys(ratio).length === 0) {
    return `${spec.base.size_range.join(' · ')} — раскладка по размерам уточняется`;
  }
  const parts = spec.base.size_range.map((ru) => `${ru}: ${ratio[String(ru)] ?? 0}`);
  return parts.join(' · ');
}

/**
 * Текст для мессенджера — не больше 500 знаков.
 *
 * Ограничение не косметическое: длинное сообщение в мессенджере читают
 * по диагонали или не читают вовсе, а разбитое на части теряет начало.
 * Поэтому текст собирается по УБЫВАНИЮ важности и обрезается блоками
 * с конца, пока не поместится. Обрезать посередине фразы нельзя: получится
 * сообщение, которое выглядит как ошибка отправителя.
 */
export const RFQ_TEXT_LIMIT = 500;

export function rfqText(spec: StyleSpec, options: RfqOptions = {}): string {
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  const qty = spec.bom?.batch_qty;
  const contact = options.contact;

  // Порядок блоков — порядок вопросов фабрики. Последние отпадают первыми.
  const blocks: string[] = [
    `Просчёт: ${CATEGORY_LABEL_RU[spec.style.category as Category]}, ` +
      `${FIT_INTENT_LABEL_RU[spec.base.fit_intent as FitIntent]}.`,
    shell
      ? `Полотно: ${shell.name_ru.toLowerCase()}` +
        (shell.gsm ? `, ${num(shell.gsm.value)} г/м²` : '') +
        `.`
      : '',
    qty ? `Тираж: ${qty} шт.` : 'Тираж уточняется.',
    `Размеры: ${rfqSizeLine(spec, options.sizeRatio)}.`,
    ...rfqHighlights(spec).map((h) => `${h[0]!.toUpperCase()}${h.slice(1)}.`),
    options.packLink
      ? `Техпак с замерами, узлами и допусками: ${options.packLink}`
      : 'Техпак с замерами, узлами и допусками готов — пришлю по запросу.',
    // Имя без телефона и почты каналом связи не является: «Связь: Данил» в
    // мессенджере выглядит заполненной строкой и остаётся тупиком. Лучше
    // строки не будет вовсе — тогда пробел виден и его чинят.
    contact?.phone || contact?.email
      ? `Связь: ${[contact.name, contact.phone, contact.email].filter(Boolean).join(', ')}.`
      : '',
  ].filter(Boolean);

  // Контакт отпадает последним: сообщение без него бессмысленно. Если
  // контакта нет вовсе, последним блоком оказывается ссылка на техпак —
  // она тоже обязана уцелеть при обрезке.
  const contactBlock = blocks.at(-1)!;
  const body = blocks.slice(0, -1);

  let text = [...body, contactBlock].join(' ');
  while (text.length > RFQ_TEXT_LIMIT && body.length > 1) {
    body.pop();
    text = [...body, contactBlock].join(' ');
  }

  // Даже урезанный до предела текст может не влезть, если контакт длинный.
  // Тогда режем по границе слова и ставим многоточие: обрубок посреди
  // слова читается как сбой отправителя.
  if (text.length > RFQ_TEXT_LIMIT) {
    const cut = text.slice(0, RFQ_TEXT_LIMIT - 1);
    text = `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`;
  }

  return text;
}

/** Одностраничный лист на просчёт. A4 портрет — его отправляют почтой. */
export function renderRfqHtml(spec: StyleSpec, options: RfqOptions = {}): string {
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  const rib = spec.bom?.lines.find((l) => l.role === 'rib');
  // Вид переда: из библиотеки, если пак собран из неё, иначе строим сами.
  // Оба документа обязаны показывать одно и то же изделие.
  const sketch = options.flat?.svg ?? renderFlatsFromSpec(spec).front.svg;
  const contact = options.contact;
  const highlights = rfqHighlights(spec);

  const rows: [string, string][] = [
    // Название уже стоит заголовком листа: повторять его в первой строке
    // значит тратить строку на то, что человек только что прочитал.
    ['Категория', CATEGORY_LABEL_RU[spec.style.category as Category]],
    ['Артикул', esc(spec.style.article)],
    ['Посадка', FIT_INTENT_LABEL_RU[spec.base.fit_intent as FitIntent]],
    [
      'Полотно',
      shell
        ? `${esc(shell.name_ru)}${shell.gsm ? `, ${num(shell.gsm.value)} г/м²` : ''} · ` +
          `${esc(shell.composition.value)}`
        : 'уточняется',
    ],
    ...(rib
      ? ([['Отделка', `${esc(rib.name_ru)} — ${esc(rib.placement_ru)}`]] as [string, string][])
      : []),
    ['Тираж', spec.bom?.batch_qty ? `${spec.bom.batch_qty} шт` : 'уточняется'],
    ['Размерный ряд', esc(rfqSizeLine(spec, options.sizeRatio))],
    [
      'Расход полотна',
      spec.bom
        ? `${num(spec.bom.fabric_consumption_m.value)} м на изделие` +
          (spec.bom.batch_consumption_m ? ` · ${num(spec.bom.batch_consumption_m)} м на тираж` : '')
        : '—',
    ],
  ];

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Лист на просчёт — ${esc(spec.style.article)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Sora, "Helvetica Neue", Arial, sans-serif; color: #0E0E0E; font-size: 9.5pt; }
  .kicker { font-size: 7.4pt; letter-spacing: 1.4px; text-transform: uppercase; font-weight: 700; color: #6B6B67; }
  h1 { font-size: 17pt; font-weight: 700; margin: 1mm 0 1mm; letter-spacing: -0.3px; }
  .head { border-bottom: 1px solid #E4E1DC; padding-bottom: 3mm; margin-bottom: 5mm; }
  .top { display: grid; grid-template-columns: 1fr 52mm; gap: 8mm; align-items: start; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1.8mm 0; border-bottom: 1px solid #EFEDE9; vertical-align: top; }
  td.k { width: 34mm; color: #5A5A56; font-size: 8.5pt; }
  td.v { font-family: Inter, Arial, sans-serif; font-weight: 300; color: #C0392B; }
  .sketch { border: 1px solid #E4E1DC; border-radius: 2mm; padding: 3mm; }
  .sketch svg { width: 100%; height: auto; max-height: 60mm; }
  .sketch figcaption { margin: 2mm 0 0; font-size: 7pt; letter-spacing: 1.2px; text-transform: uppercase; color: #6B6B67; text-align: center; }
  h2 { font-size: 10pt; margin: 6mm 0 2mm; }
  ul { margin: 0; padding-left: 4.5mm; line-height: 1.5; }
  .note { font-size: 8pt; color: #5A5A56; line-height: 1.45; }
  .ask { border: 1px solid #0E0E0E; border-radius: 2mm; padding: 4mm 5mm; margin-top: 6mm; }
  .ask ol { margin: 1.5mm 0 0; padding-left: 4.5mm; line-height: 1.6; }
  .contact { margin-top: 5mm; padding-top: 3mm; border-top: 1px solid #E4E1DC; }
  .warn { color: #C0392B; }
</style></head><body>

<div class="head">
  <div class="kicker">Лист на просчёт</div>
  <h1>${esc(spec.style.name)}</h1>
  <div class="note">${esc(spec.style.description ?? '')}</div>
</div>

<div class="top">
  <table><tbody>
    ${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${v}</td></tr>`).join('')}
  </tbody></table>
  <figure class="sketch" style="margin:0">
    ${sketch}
    <figcaption>Перед · чертёж из техпака</figcaption>
  </figure>
</div>

${
  highlights.length
    ? `<h2>Что влияет на цену и срок</h2><ul>` +
      highlights.map((h) => `<li>${esc(h)}</li>`).join('') +
      `</ul>`
    : ''
}

<div class="ask">
  <div class="kicker">Что нужно от вас</div>
  <ol>
    <li>Цена за изделие при этом тираже${options.replyBy ? ` — ответ до ${esc(options.replyBy)}` : ''}</li>
    <li>Минимальная партия, при которой вы беретесь</li>
    <li>Срок от подтверждения образца до отгрузки</li>
    <li>Что из перечисленного вы не делаете у себя и отдаёте подрядчику</li>
  </ol>
</div>

<div class="note" style="margin-top:5mm">
  Технический пакет готов: табель мер с допусками по ГОСТ 23193-78, узлы обработки
  с кодами швов и типом оборудования, технологическая последовательность,
  спецификация материалов и маркировка. ${
    options.packLink
      ? `Открыть целиком: <b>${esc(options.packLink)}</b>. Просчитывать по этому листу, а не по нему.`
      : 'Пришлём по запросу — просчитывать по этому листу, а не по нему.'
  }
</div>

<div class="contact">
  <div class="kicker">Кому отвечать</div>
  ${
    contact?.company || contact?.name
      ? `<div style="margin-top:1.5mm">${[
          contact.company,
          contact.name,
          contact.phone,
          contact.email,
        ]
          .filter(Boolean)
          .map((x) => esc(String(x)))
          .join(' · ')}</div>`
      : ''
  }
  ${
    // Имя и компания говорят, ОТ КОГО лист. Ответить на них нельзя: канал
    // ответа — это номер или адрес. Строка с одним именем выглядит
    // заполненной и остаётся тупиком, поэтому предупреждение стоит рядом
    // с ней, а не вместо неё.
    contact?.phone || contact?.email
      ? ''
      : `<div class="warn" style="margin-top:1.5mm">Телефон и почта не указаны — фабрике
         некуда ответить. Заполните профиль бренда перед отправкой.</div>`
  }
</div>

</body></html>`;
}
