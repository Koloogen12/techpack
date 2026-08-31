import { renderFlatsFromSpec } from '@seamster/flats';
import {
  CATEGORY_LABEL_EN,
  CATEGORY_LABEL_RU,
  CATEGORY_LABEL_ZH,
  FIT_INTENT_LABEL_EN,
  FIT_INTENT_LABEL_RU,
  FIT_INTENT_LABEL_ZH,
  MATERIAL_ROLE_LABEL_EN,
  MATERIAL_ROLE_LABEL_ZH,
  type Category,
  type FitIntent,
} from '@seamster/kb';
import { messages, type Locale } from '@seamster/i18n';
import type { StyleSpec } from '@seamster/stylespec';

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
  /**
   * Язык листа.
   *
   * Просчёт — первый контакт с фабрикой, и непонятная бумага на нём
   * заканчивается: русский лист китайскому цеху бесполезен ровно так же,
   * как русский техпак.
   */
  locale?: Locale | undefined;
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`,
  );

const num = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');

/** Ключевые особенности: то, что меняет цену и сроки. */
export function rfqHighlights(spec: StyleSpec, locale: Locale = 'ru'): string[] {
  const t = messages(locale);
  const out: string[] = [];
  // Подписи зон, техник и узлов уже переведены в самой спеке: пак печатает
  // их теми же полями. Брать здесь русский вариант значило бы завести
  // второй перевод одного и того же и однажды их развести.
  const pick = (en?: string, zh?: string, ru?: string): string =>
    (locale === 'zh' ? (zh ?? en) : locale === 'en' ? en : ru) ?? ru ?? en ?? '';

  for (const a of spec.artwork?.placements ?? []) {
    out.push(
      a.kind === 'allover'
        ? t.rfq_hl_allover(num(a.size_cm.width.value), a.pattern?.path === 'roll')
        : t.rfq_hl_artwork(
            pick(a.zone_label_en, a.zone_label_zh, a.zone_label_ru).toLowerCase(),
            num(a.size_cm.width.value),
            num(a.size_cm.height.value),
            pick(a.technique_label_en, a.technique_label_zh, a.technique_label_ru).toLowerCase(),
          ),
    );
  }

  // Узлы вне базового парка — самая частая причина отказа фабрики
  // (knowledge-base/07 §3). Молчать о них на просчёте значит получить
  // отказ на следующем шаге, потратив время обеих сторон.
  const special = (spec.construction?.nodes ?? []).filter((n) => n.requires_special_equipment);
  if (special.length) {
    out.push(
      t.rfq_hl_special(
        special.map((n) => pick(n.label_en, n.label_zh, n.label_ru).toLowerCase()).join(', '),
      ),
    );
  }

  const colorways = spec.bom?.colorways.length ?? 0;
  if (colorways > 1) out.push(t.rfq_hl_colorways(colorways));

  return out;
}

/** Строка размерного ряда: с раскладкой, если она задана, иначе честно без. */
export function rfqSizeLine(
  spec: StyleSpec,
  ratio?: Readonly<Record<string, number>>,
  locale: Locale = 'ru',
): string {
  if (!ratio || Object.keys(ratio).length === 0) {
    return `${spec.base.size_range.join(' · ')} — ${messages(locale).rfq_ratio_tbc}`;
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
  const locale = options.locale ?? 'ru';
  const t = messages(locale);
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  const qty = spec.bom?.batch_qty;
  const contact = options.contact;
  const fabricName =
    locale === 'zh'
      ? (shell?.name_zh ?? shell?.name_en ?? shell?.name_ru)
      : locale === 'en'
        ? (shell?.name_en ?? shell?.name_ru)
        : shell?.name_ru;

  // Порядок блоков — порядок вопросов фабрики. Последние отпадают первыми.
  const blocks: string[] = [
    t.rfq_text_quote(categoryLabel(spec, locale), fitLabel(spec, locale)),
    shell && fabricName
      ? t.rfq_text_fabric(
          // Строчная буква уместна в русском и английском; иероглифы
          // регистра не имеют, и toLowerCase там просто ничего не делает.
          locale === 'zh' ? fabricName : fabricName.toLowerCase(),
          shell.gsm ? num(shell.gsm.value) : null,
        )
      : '',
    t.rfq_text_qty(qty ?? null),
    t.rfq_text_sizes(rfqSizeLine(spec, options.sizeRatio, locale)),
    ...rfqHighlights(spec, locale).map((h) =>
      locale === 'zh' ? `${h}。` : `${h[0]!.toUpperCase()}${h.slice(1)}.`,
    ),
    options.packLink ? t.rfq_text_pack_link(options.packLink) : t.rfq_text_pack,
    // Имя без телефона и почты каналом связи не является: «Связь: Данил» в
    // мессенджере выглядит заполненной строкой и остаётся тупиком. Лучше
    // строки не будет вовсе — тогда пробел виден и его чинят.
    contact?.phone || contact?.email
      ? t.rfq_text_contact([contact.name, contact.phone, contact.email].filter(Boolean).join(', '))
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
    const space = cut.lastIndexOf(' ');
    // В китайском пробелов между словами нет, и резать по ним нечего:
    // иероглиф — сам по себе граница.
    text = `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }

  return text;
}

/** Категория и посадка на языке листа: словари уже есть, свои заводить не за чем. */
function categoryLabel(spec: StyleSpec, locale: Locale): string {
  const category = spec.style.category as Category;
  if (locale === 'zh') return CATEGORY_LABEL_ZH[category];
  if (locale === 'en') return CATEGORY_LABEL_EN[category];
  return CATEGORY_LABEL_RU[category];
}

function fitLabel(spec: StyleSpec, locale: Locale): string {
  const fit = spec.base.fit_intent as FitIntent;
  if (locale === 'zh') return FIT_INTENT_LABEL_ZH[fit];
  if (locale === 'en') return FIT_INTENT_LABEL_EN[fit];
  return FIT_INTENT_LABEL_RU[fit];
}

/** Одностраничный лист на просчёт. A4 портрет — его отправляют почтой. */
export function renderRfqHtml(spec: StyleSpec, options: RfqOptions = {}): string {
  const locale = options.locale ?? 'ru';
  const t = messages(locale);
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  const rib = spec.bom?.lines.find((l) => l.role === 'rib');
  // Названия материалов и составы переведены в самой спеке — теми же
  // полями, которыми их печатает пак.
  const name = (l: typeof shell): string =>
    (locale === 'zh'
      ? (l?.name_zh ?? l?.name_en ?? l?.name_ru)
      : locale === 'en'
        ? (l?.name_en ?? l?.name_ru)
        : l?.name_ru) ?? '';
  const composition = (l: typeof shell): string =>
    (locale === 'zh'
      ? (l?.composition_zh ?? l?.composition_en ?? l?.composition.value)
      : locale === 'en'
        ? (l?.composition_en ?? l?.composition.value)
        : l?.composition.value) ?? '';
  // Вид переда: из библиотеки, если пак собран из неё, иначе строим сами.
  // Оба документа обязаны показывать одно и то же изделие.
  //
  // Подпись вида ВШИТА В САМ SVG, и по умолчанию она русская: на китайском
  // листе внутри картинки стояло «ПЕРЕД». Передаём подписи на языке листа —
  // это единственное место, где русское слово пролезало сквозь всю
  // локализацию, потому что жило не в разметке, а в графике.
  const sketch =
    options.flat?.svg ??
    renderFlatsFromSpec(spec, {
      viewLabels: { front: t.view_front, back: t.view_back, side: t.view_side },
    }).front.svg;
  const contact = options.contact;
  const highlights = rfqHighlights(spec, locale);

  const rows: [string, string][] = [
    // Название уже стоит заголовком листа: повторять его в первой строке
    // значит тратить строку на то, что человек только что прочитал.
    [t.rfq_row_category, categoryLabel(spec, locale)],
    [t.rfq_row_article, esc(spec.style.article)],
    [t.rfq_row_fit, fitLabel(spec, locale)],
    [
      t.rfq_row_fabric,
      shell
        ? `${esc(name(shell))}${shell.gsm ? `, ${num(shell.gsm.value)} ${esc(t.rfq_gsm_unit)}` : ''} · ` +
          `${esc(composition(shell))}`
        : esc(t.to_be_confirmed),
    ],
    ...(rib
      ? ([
          [
            t.rfq_row_trim,
            // Назначение в нерусском листе берётся из РОЛИ материала, а не
            // из вольного текста: роль — замкнутое перечисление, её перевод
            // полон по устройству. Тот же приём, что в самом паке.
            `${esc(name(rib))} — ${esc(
              locale === 'ru'
                ? rib.placement_ru
                : locale === 'zh'
                  ? MATERIAL_ROLE_LABEL_ZH[rib.role]
                  : MATERIAL_ROLE_LABEL_EN[rib.role],
            )}`,
          ],
        ] as [string, string][])
      : []),
    [
      t.rfq_row_qty,
      spec.bom?.batch_qty
        ? `${spec.bom.batch_qty} ${esc(t.rfq_units_pcs)}`
        : esc(t.to_be_confirmed),
    ],
    [t.rfq_row_sizes, esc(rfqSizeLine(spec, options.sizeRatio, locale))],
    [
      t.rfq_row_consumption,
      spec.bom
        ? esc(
            t.rfq_consumption(
              num(spec.bom.fabric_consumption_m.value),
              spec.bom.batch_consumption_m ? num(spec.bom.batch_consumption_m) : null,
            ),
          )
        : '—',
    ],
  ];

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<title>${esc(t.rfq_kicker)} — ${esc(spec.style.article)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Sora, "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif; color: #0E0E0E; font-size: 9.5pt; }
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
  <div class="kicker">${esc(t.rfq_kicker)}</div>
  <h1>${esc(spec.style.name)}</h1>
  <div class="note">${esc(spec.style.description ?? '')}</div>
</div>

<div class="top">
  <table><tbody>
    ${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${v}</td></tr>`).join('')}
  </tbody></table>
  <figure class="sketch" style="margin:0">
    ${sketch}
    <figcaption>${esc(t.rfq_sketch_caption)}</figcaption>
  </figure>
</div>

${
  highlights.length
    ? `<h2>${esc(t.rfq_affects_title)}</h2><ul>` +
      highlights.map((h) => `<li>${esc(h)}</li>`).join('') +
      `</ul>`
    : ''
}

<div class="ask">
  <div class="kicker">${esc(t.rfq_ask_title)}</div>
  <ol>
    <li>${esc(t.rfq_ask_price)}${options.replyBy ? esc(t.rfq_ask_reply_by(options.replyBy)) : ''}</li>
    <li>${esc(t.rfq_ask_moq)}</li>
    <li>${esc(t.rfq_ask_lead_time)}</li>
    <li>${esc(t.rfq_ask_outsourced)}</li>
  </ol>
</div>

<div class="note" style="margin-top:5mm">
  ${esc(t.rfq_pack_note)}
  ${options.packLink ? esc(t.rfq_pack_open(options.packLink)) : esc(t.rfq_pack_on_request)}
</div>

<div class="contact">
  <div class="kicker">${esc(t.rfq_contact_title)}</div>
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
      : `<div class="warn" style="margin-top:1.5mm">${esc(t.rfq_contact_missing)}</div>`
  }
</div>

</body></html>`;
}
