import { CONFIDENCE_LABEL_RU, CONFIDENCE_LEVELS, type Confidence } from '@specform/core';
import { renderFlatsFromSpec } from '@specform/flats';
import {
  CATEGORY_LABEL_RU,
  FIT_INTENT_LABEL_RU,
  MACHINE_LABEL_RU,
  SPECIALTY_LABEL_RU,
  ZONE_LABEL_RU,
  type Category,
  type FitIntent,
  type MachineType,
  type NodeZone,
  type Specialty,
} from '@specform/kb';
import type { StyleSpec } from '@specform/stylespec';
import { DOC_CSS } from './styles.js';

/**
 * Рендер техпака в HTML. Дальше он превращается в PDF тем же движком,
 * что рисует веб-интерфейс, — поэтому превью документа в приложении
 * достаётся бесплатно (ADR-0000).
 *
 * Состав страниц — knowledge-base/01 §1 и §2 (минимальный комплект для
 * фабрики РФ). Модульность под цех — knowledge-base/07 §6.6: табель мер
 * идёт в ОТК, спецификация закройщику, расчётник снабжению, поэтому каждая
 * секция это отдельная страница и её можно выгрузить отдельно.
 *
 * ВАЖНО про вёрстку: страница имеет фиксированную высоту, поэтому длинные
 * таблицы разбиваются на страницы ЯВНО, а не отдаются на волю движка печати.
 * Иначе строки, не поместившиеся на лист, накладываются на следующий раздел —
 * документ выглядит битым, а часть замеров теряется. Проверено на первом же
 * прогоне: табель мер из 18 точек не влезал, и спецификация материалов
 * печаталась поверх него.
 */

export const DOC_SECTIONS = [
  'cover',
  'preview',
  'flats',
  'measurements',
  'bom',
  'construction',
  'artwork',
  'pattern_preview',
  'labels',
  'patterns',
] as const;
export type DocSection = (typeof DOC_SECTIONS)[number];

/** Картинка, готовая к вставке: data-URI, содержимого файлов в спеке нет. */
export interface DocImage {
  dataUri: string;
  label?: string;
}

/**
 * Растровые изображения документа.
 *
 * Передаются ОТДЕЛЬНО от спеки, а не внутри неё: StyleSpec хранит ссылки на
 * файлы, но не их содержимое (`AssetRefSchema`). Иначе спека раздувается
 * до мегабайтов, отпечаток начинает зависеть от байтов картинки,
 * и воспроизводимость документа ломается на ровном месте.
 */
export interface DocVisuals {
  /** Визуализация изделия из спеки. Превью, не источник размеров. */
  render?: DocImage;
  /** Снимки, которые прислал заказчик. */
  photos?: readonly DocImage[];
  /**
   * Тайл раппорта для превью на изделии.
   *
   * Чертёж рисуется в сантиметрах, поэтому шаг здесь РАЗМЕРНО ТОЧЕН: 24 см
   * на изделии дают 24 см на рисунке. У конкурента превью декоративное —
   * ползунок «×4 повтора» ни к чему не привязан, и по нему нельзя понять,
   * будет мотив с ладонь или с монету.
   */
  patternTile?: { dataUri: string; repeatCm: number };
  /**
   * Фотореалистичное изделие в раппорте. Строится тем же механизмом, что
   * и страница внешнего вида, и наследует все её правила: не для замеров,
   * кэш по отпечатку, вне цеховых выгрузок.
   */
  patternRender?: DocImage;
}

export interface HtmlOptions {
  /** Какие страницы включить. По умолчанию все. */
  sections?: readonly DocSection[];
  /** Pro-режим раскрывает плотность: коды ГОСТ, SPI, техпоследовательность. */
  pro?: boolean;
  /** Подпись роли в колонтитуле — для выгрузок по ролям. */
  roleLabel?: string;
  visuals?: DocVisuals;
}

/**
 * Сколько строк помещается на лист A4 в альбомной ориентации.
 * Значения подобраны по факту печати с запасом на перенос текста в ячейках.
 */
const ROWS_PER_PAGE = {
  measurements: 15,
  notes: 17,
  bom: 14,
  nodes: 7,
  sequence: 17,
  sku: 17,
} as const;

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`,
  );

const num = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');

function chunk<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Точка статуса плюс уже готовая подпись.
 *
 * Нужна там, где само значение — внутренний ключ (`screen`, `dtf`), а человеку
 * показывается русское название. Печатать ключ рядом с названием значит
 * протаскивать английский в русский документ: ровно та ошибка, которую
 * стережёт golden/language.test.ts.
 */
function labelled(v: { confidence: Confidence }, label: string): string {
  return (
    `<span class="dot dot-${v.confidence}" title="${CONFIDENCE_LABEL_RU[v.confidence]}"></span>` +
    `<span class="v">${esc(label)}</span>`
  );
}

/** Точка статуса плюс значение. Один компонент на весь документ. */
function value(v: { value: string | number; confidence: Confidence }): string {
  const text = typeof v.value === 'number' ? num(v.value) : esc(v.value);
  return (
    `<span class="dot dot-${v.confidence}" title="${CONFIDENCE_LABEL_RU[v.confidence]}"></span>` +
    `<span class="v">${text}</span>`
  );
}

interface Page {
  section: DocSection;
  title: string;
  body: string;
  /** «страница 2 из 3» для разрезанных таблиц. */
  part?: { index: number; total: number };
}

export function renderHtml(spec: StyleSpec, options: HtmlOptions = {}): string {
  const sections = options.sections ?? DOC_SECTIONS;
  const pro = options.pro ?? false;
  const include = (s: DocSection): boolean => sections.includes(s);

  const pages: Page[] = [];
  const add = (section: DocSection, title: string, bodies: string[]): void => {
    if (!include(section)) return;
    bodies.forEach((body, i) =>
      pages.push(
        bodies.length > 1
          ? { section, title, body, part: { index: i + 1, total: bodies.length } }
          : { section, title, body },
      ),
    );
  };

  add('cover', 'Технический пакет', [coverBody(spec)]);
  // Страницы внешнего вида нет, если показывать нечего: пустой лист
  // с рамками хуже отсутствующего раздела. Тело собирается только когда
  // раздел действительно нужен — в нём мегабайты data-URI.
  if (include('preview')) {
    const preview = previewBody(spec, options.visuals);
    if (preview) add('preview', 'Внешний вид', [preview]);
  }
  if (include('flats')) add('flats', 'Технический чертёж', [flatsBody(renderFlatsFromSpec(spec))]);
  add('measurements', 'Табель мер', measurementsPages(spec, pro));
  add('bom', 'Спецификация материалов', bomPages(spec));
  add('construction', 'Конструкция', constructionPages(spec, pro));
  if (spec.artwork) add('artwork', 'Нанесение', artworkPages(spec, spec.artwork, options.visuals));
  // Фотореалистичное превью раппорта — ОТДЕЛЬНЫЙ раздел, а не третий лист
  // нанесения. Разделы это единица ролевой выгрузки: цеху и печатнику
  // такая картинка не нужна и только отвлекает от размерной раскладки.
  if (include('pattern_preview')) {
    const body = patternPreviewBody(spec, options.visuals);
    if (body) add('pattern_preview', 'Раппорт на изделии', [body]);
  }
  add('labels', 'Маркировка и артикулы', labelsPages(spec));
  add('patterns', 'Лекала и раскладка', [patternsBody()]);

  // Общее число листов известно только когда собраны все: футер печатает
  // «лист N из M», и документ без M заставляет технолога гадать, всё ли
  // ему прислали.
  const total = pages.length;
  const html = pages.map((p, i) => pageShell(spec, p, i + 1, total, options)).join('');

  return (
    `<!doctype html><html lang="ru"><head><meta charset="utf-8">` +
    `<title>${esc(spec.style.name)} — ${esc(spec.style.article)}</title>` +
    `<style>${DOC_CSS}</style></head><body>${html}</body></html>`
  );
}

/**
 * Оболочка страницы: мастхед, мета-полоса, содержимое, футер.
 *
 * Мастхед несёт бренд КЛИЕНТА, а не наш. Документ принадлежит бренду
 * и показывается фабрике от его имени; Seamsterly живёт в футере.
 * У эталона наоборот — своё имя сверху, — и это ровно та мелочь,
 * из-за которой документ выглядит чужим.
 *
 * Мета-полоса повторяется на КАЖДОЙ странице. Листы расходятся по цеху
 * поодиночке: закройщик держит один, ОТК другой, и лист без артикула
 * и версии на нём — это лист неизвестно от чего.
 */
function pageShell(
  spec: StyleSpec,
  page: Page,
  index: number,
  total: number,
  options: HtmlOptions,
): string {
  const brand = spec.style.brand?.trim();
  const part = page.part ? ` · лист ${page.part.index} из ${page.part.total}` : '';

  const meta: [string, string][] = [
    ['Бренд', brand ? esc(brand) : tbc('профиль бренда')],
    ['Модель', esc(spec.style.name)],
    ['Артикул', esc(spec.style.article)],
    ['Сезон', spec.style.season ? esc(spec.style.season) : tbc('анкета')],
    ['Базовый размер', `RU ${spec.base.base_size_ru} · рост ${num(spec.base.base_height_cm)}`],
    [
      'Версия · тираж',
      `${esc(spec.spec_version)}${spec.bom?.batch_qty ? ` · ${spec.bom.batch_qty} шт` : ''}`,
    ],
  ];

  return (
    `<section class="page" data-section="${page.section}"` +
    (page.part ? ` data-part="${page.part.index}/${page.part.total}"` : '') +
    `>` +
    `<div class="masthead">` +
    `<div class="brand">${brand ? esc(brand) : esc(spec.style.name)}</div>` +
    `<div class="ml">${esc(page.title)}${esc(part)}` +
    (options.roleLabel ? `<span class="role">для ${esc(options.roleLabel)}</span>` : '') +
    `</div></div>` +
    `<div class="meta">` +
    meta
      .map(([k, v]) => `<div><div class="ml">${esc(k)}</div><div class="value">${v}</div></div>`)
      .join('') +
    `</div>` +
    `<div class="body">${page.body}</div>` +
    `<div class="foot">` +
    `<span>Seamsterly · ${esc(spec.style.article)}</span>` +
    `<span class="legend">${statusLegend()}</span>` +
    `<span>Лист ${index} из ${total}</span>` +
    `</div></section>`
  );
}

/** Заглушка всегда говорит, что сюда придёт и откуда. */
function tbc(source: string): string {
  return `<span class="tbc">[не заполнено — ${esc(source)}]</span>`;
}

/** Мини-легенда статусов в футере: она нужна на каждом листе, а не только на первом. */
function statusLegend(): string {
  return LEGEND.map(
    ([c]) =>
      `<span class="legend-item"><span class="dot dot-${c}"></span>` +
      `${esc(CONFIDENCE_LABEL_RU[c])}</span>`,
  ).join('');
}

// ---------------------------------------------------------------- обложка

const LEGEND: [Confidence, string][] = [
  ['fit_confirmed', 'снято с отшитого образца'],
  ['user_input', 'сообщил заказчик'],
  ['estimated_from_photo', 'получено из пропорций на снимке'],
  ['default_from_base', 'взято из отраслевого справочника'],
  ['assumption', 'подтвердить по образцу до запуска партии'],
];

function coverBody(spec: StyleSpec): string {
  const passport: [string, string][] = [
    ['Категория', CATEGORY_LABEL_RU[spec.style.category as Category]],
    ['Посадка', FIT_INTENT_LABEL_RU[spec.base.fit_intent as FitIntent]],
    ['Полотно', shellLine(spec) ?? tbc('спецификация материалов')],
    ['Размерный ряд', spec.base.size_range.join(' · ')],
    ['Тираж', spec.bom?.batch_qty ? `${spec.bom.batch_qty} шт` : tbc('анкета')],
  ];

  const sources = countBySource(spec);
  const assumptions = spec.meta.assumptions_count;
  const calculated = Object.values(sources).reduce((a, b) => a + b, 0);

  // Ключевые элементы конструкции — то, за что цепляется глаз технолога
  // на первой странице. Берём видимые узлы: невидимые ему на обложке
  // ничего не скажут, а место займут.
  //
  // Число элементов подстраивается под длину описания. Урезаем именно их,
  // а не описание: узлы целиком повторены в разделе конструкции, а описание
  // изделия живёт только здесь — потерять его значило бы потерять данные,
  // тогда как список тут работает анонсом.
  const described = spec.style.description?.length ?? 0;
  const room = Math.max(2, 5 - Math.floor(described / 90));
  const features = (spec.construction?.nodes ?? [])
    .filter((n) => n.visible_on_photo)
    .slice(0, room)
    .map((n) => `<b>${esc(n.label_ru)}.</b> ${esc(n.plain_ru)}`);

  const flats = renderFlatsFromSpec(spec);

  return (
    `<div class="cover">` +
    // Левая половина — холст с чертежом. Ровно та композиция, которой
    // эталон обязан своим видом: вещь лежит на столе студии.
    `<div class="canvas">` +
    `<div class="ml">Технический чертёж</div>` +
    `<figure>${flats.front.svg}<figcaption class="ml">Перед</figcaption></figure>` +
    `<figure>${flats.back.svg}<figcaption class="ml">Спинка</figcaption></figure>` +
    `</div>` +
    // Правая — паспорт изделия и сводка честности.
    `<div style="display:flex;flex-direction:column;min-height:0">` +
    // Длинное название набирается мельче, а не выталкивает содержимое
    // за лист: имя изделия придумывает заказчик, и ограничивать его
    // длину значило бы решать за него.
    `<h1${spec.style.name.length > 34 ? ' style="font-size:15pt"' : ''}>` +
    `${esc(spec.style.name)}</h1>` +
    `<table class="plain"><tbody>` +
    passport.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`).join('') +
    `</tbody></table>` +
    (spec.style.description
      ? `<div class="note" style="margin-top:4mm">${esc(spec.style.description)}</div>`
      : '') +
    (features.length
      ? `<h3>Ключевые элементы конструкции</h3><ul class="dash">` +
        features.map((f) => `<li>${f}</li>`).join('') +
        `</ul>`
      : '') +
    `<div style="flex:1"></div>` +
    honestySummary(calculated, assumptions, sources) +
    `</div></div>`
  );
}

/** Полотно одной строкой: то, что фабрика ищет на обложке первым. */
function shellLine(spec: StyleSpec): string | null {
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  if (!shell) return null;
  return (
    esc(shell.name_ru) +
    (shell.gsm ? `, ${num(shell.gsm.value)} г/м²` : '') +
    ` · ${esc(shell.composition.value)}`
  );
}

/**
 * Сводка честности — то, чего нет ни у кого.
 *
 * Одной строкой отвечает на вопрос, который технолог задаёт про любой
 * присланный пак: сколько здесь посчитано, а сколько подставлено.
 * Легенда рядом, потому что на обложке она читается один раз и дальше
 * работает памятью — в футере остаётся напоминание.
 */
function honestySummary(
  calculated: number,
  assumptions: number,
  sources: Record<Confidence, number>,
): string {
  return (
    `<div class="card${assumptions > 0 ? ' warn' : ''}" style="margin-top:5mm">` +
    `<div class="ml">Откуда взяты значения</div>` +
    `<div style="font-size:8.6pt;margin:2mm 0 3mm">` +
    `<b>${calculated}</b> значений в документе` +
    (assumptions > 0
      ? ` · <span class="dot dot-assumption"></span><b>${assumptions}</b> подтвердить по образцу`
      : ' · предположений нет') +
    `</div>` +
    // Легенда здесь компактная: расшифровка каждого статуса повторяется
    // в футере на всех последующих листах, и печатать её дважды значит
    // тратить место, которого на обложке и так нет.
    `<div style="display:grid;grid-template-columns:1fr auto 1fr auto;gap:1.2mm 3mm;font-size:7.6pt">` +
    LEGEND.filter(([c]) => sources[c] > 0)
      .map(
        ([c]) =>
          `<div><span class="dot dot-${c}"></span>${esc(CONFIDENCE_LABEL_RU[c])}</div>` +
          `<div class="num v">${sources[c]}</div>`,
      )
      .join('') +
    `</div>` +
    (assumptions > 0
      ? `<div class="note warn" style="margin-top:2.5mm">Предположение — типовая подстановка ` +
        `там, где увидеть правду было нельзя. Подтвердите по образцу до запуска партии.</div>`
      : '') +
    `</div>`
  );
}

/**
 * Сколько значений пришло из каждого источника.
 *
 * Счётчик строится ИЗ СПИСКА статусов, а не из литерала с перечисленными
 * ключами. Литерал уже подвёл однажды: при добавлении статуса «измерено
 * по масштабу» его забыли, и `counts[...]++` на отсутствующем ключе давал
 * NaN — молча, пока сумму не начали печатать на обложке.
 */
function countBySource(spec: StyleSpec): Record<Confidence, number> {
  const counts = Object.fromEntries(CONFIDENCE_LEVELS.map((c) => [c, 0])) as Record<
    Confidence,
    number
  >;

  for (const p of spec.measurements.points) counts[p.base.confidence]++;
  for (const n of spec.construction?.nodes ?? []) counts[n.presence.confidence]++;
  for (const l of spec.bom?.lines ?? []) counts[l.composition.confidence]++;
  return counts;
}

// ------------------------------------------------------------ внешний вид

/**
 * Пропускаем всё, что не является картинкой в data-URI.
 *
 * Значение уходит в атрибут `src`, а туда нельзя пускать строку, которую
 * кто-то когда-нибудь соберёт из пользовательского ввода. Сейчас источник
 * свой, но проверка стоит ноль, а её отсутствие однажды обойдётся дорого.
 */
function safeDataUri(uri: string): string | null {
  return /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(uri) ? uri : null;
}

function frame(image: DocImage, caption: string): string {
  const src = safeDataUri(image.dataUri);
  if (!src) return '';
  return (
    `<figure><div class="frame"><img src="${src}" alt=""></div>` +
    `<figcaption>${esc(caption)}</figcaption></figure>`
  );
}

/**
 * Страница «Внешний вид».
 *
 * Отвечает на вопрос, которого в документе не было: что это за вещь и как она
 * будет выглядеть. Чертёж говорит, где мерить, таблица — сколько сантиметров,
 * а «похоже ли это на то, что я задумал» до сих пор не отвечало ничто.
 *
 * Визуализация и снимки заказчика стоят рядом СПЕЦИАЛЬНО. Так страница
 * работает как проверка: если картинка, собранная из спеки, не похожа на
 * присланное фото, значит пайплайн понял вещь неправильно, и это видно
 * человеку за секунду. Порознь это расхождение не заметил бы никто.
 *
 * Ни один размер документа из этой страницы не берётся — и на ней об этом
 * написано прямо.
 */
function previewBody(spec: StyleSpec, visuals?: DocVisuals): string | null {
  const render = visuals?.render && safeDataUri(visuals.render.dataUri) ? visuals.render : null;
  const photos = (visuals?.photos ?? []).filter((p) => safeDataUri(p.dataUri)).slice(0, 3);
  if (!render && photos.length === 0) return null;

  const caption =
    `${CATEGORY_LABEL_RU[spec.style.category as Category]}, ` +
    `${FIT_INTENT_LABEL_RU[spec.base.fit_intent as FitIntent]}`;

  const left = render
    ? `<figure><div class="frame"><img src="${safeDataUri(render.dataUri)}" alt=""></div>` +
      `<figcaption>Визуализация · ${esc(caption)} · <span class="flag">не для замеров</span></figcaption>` +
      `</figure>`
    : '';

  const shots = photos.length
    ? `<div class="shots">` +
      photos.map((p, i) => frame(p, p.label ?? `Снимок заказчика ${i + 1}`)).join('') +
      `</div>`
    : '';

  const body =
    left && shots
      ? `<div class="preview">${left}${shots}</div>`
      : `<div class="preview" style="grid-template-columns:1fr">${left || shots}</div>`;

  const explain = render
    ? `Визуализация построена из данных этого документа — категории, посадки, полотна, ` +
      `цвета и узлов обработки, — а не из присланного снимка. Поэтому она показывает то, ` +
      `что описано в таблицах: если вещь на картинке отличается от задуманной, ` +
      `расходятся данные, и правку нужно вносить в них. ` +
      `<b>Размеры с этой страницы не снимаются</b>: источник геометрии — чертёж и табель мер.`
    : `Снимки заказчика приложены для сверки. Размеры с них не снимаются: ` +
      `источник геометрии — чертёж и табель мер.`;

  return `${body}<div class="note" style="margin-top:3mm">${explain}</div>`;
}

// -------------------------------------------------------------- нанесение

const GRAIN_RU: Record<string, string> = {
  along: 'вдоль полотна — деталь кроится по долевой',
  across: 'поперёк полотна',
};

const CHECK_MARK: Record<'ok' | 'warn' | 'fail', string> = {
  ok: '●',
  warn: '▲',
  fail: '■',
};

/**
 * Страница нанесения — адресуется ПЕЧАТНИКУ, а не швейному цеху.
 *
 * Печать и вышивка почти всегда отдаются подрядчику (knowledge-base/07 §3),
 * и он получает изделие с одним вопросом: где и в каких сантиметрах.
 * Поэтому здесь нет ни одного «по центру груди»: только величина, точка
 * отсчёта и статус значения.
 *
 * Светофор проверок — это ответы на письма, которые печатник иначе напишет
 * сам. Каждое такое письмо стоит дня, а вопросы всегда одни и те же.
 */
function artworkPages(
  spec: StyleSpec,
  artwork: NonNullable<StyleSpec['artwork']>,
  visuals?: DocVisuals,
): string[] {
  const pages = artwork.placements.map((a) => {
    const allover = a.kind === 'allover';
    const params: [string, string][] = [
      ['Зона', esc(a.zone_label_ru)],
      ['Техника', labelled(a.technique, a.technique_label_ru)],
      ...(allover
        ? []
        : ([['Отступ', `${value(a.offset_from_anchor_cm)} см ${esc(a.anchor_label_ru)}`]] as [
            string,
            string,
          ][])),
      [
        allover ? 'Шаг раппорта' : 'Размер отпечатка',
        allover
          ? `${value(a.size_cm.width)} см`
          : `${value(a.size_cm.width)} × ${value(a.size_cm.height)} см`,
      ],
      [
        'Цвета',
        a.colors.model === 'full'
          ? 'полноцветная печать'
          : `${a.colors.count ? value(a.colors.count) : '—'} плашечных` +
            (a.colors.codes.length ? ` · ${esc(a.colors.codes.join(', '))}` : ''),
      ],
      ['Файл макета', a.file_name ? esc(a.file_name) : 'не приложен'],
      ...(a.pattern
        ? ([
            ['Путь реализации', esc(a.pattern.path_label_ru)],
            ...(a.pattern.mirrored
              ? ([['Тип раппорта', 'зеркальный (блок 2×2)']] as [string, string][])
              : ([['Тип раппорта', 'прямой']] as [string, string][])),
            [
              'Направление к долевой',
              labelled(a.pattern.grain, GRAIN_RU[a.pattern.grain.value] ?? a.pattern.grain.value),
            ],
            [
              'Метраж печати',
              a.pattern.yardage_m ? `${value(a.pattern.yardage_m)} м` : 'считается от тиража',
            ],
            [
              'Отпечаток тайла',
              `<span class="mono">${esc(a.pattern.tile_key.slice(0, 16))}</span>`,
            ],
          ] as [string, string][])
        : []),
    ];

    const checks = a.checks
      .map(
        (c) =>
          `<tr><td class="num">${CHECK_MARK[c.status]}</td>` +
          `<td><b>${esc(c.label_ru)}</b></td>` +
          `<td class="note">${esc(c.detail_ru)}</td></tr>`,
      )
      .join('');

    return (
      `<h2>${esc(a.id)} · ${esc(a.zone_label_ru)}</h2>` +
      `<div class="grid2" style="flex:1;min-height:0">` +
      `<div>` +
      `<table><tbody>` +
      params
        .map(([k, v]) => `<tr><td style="width:38mm">${esc(k)}</td><td>${v}</td></tr>`)
        .join('') +
      `</tbody></table>` +
      `<div class="note" style="margin-top:4mm">` +
      (allover
        ? `Шаг раппорта — та величина, которую печатник отмеряет по полотну. Без неё ` +
          `тайл можно напечатать в любом масштабе, и мотив выйдет хоть с ладонь, ` +
          `хоть с монету. ${esc(a.pattern?.path_reason_ru ?? '')}`
        : `Положение отмеряется по разложенному изделию рулеткой — от названной точки, ` +
          `а не на глаз. Границы зоны показаны на техническом чертеже пунктиром. ` +
          `Сам макет приложен файлом: на чертеже он не рисуется, потому что чертёж ` +
          `задаёт место и размер, а не изображение.`) +
      `</div>` +
      (a.pattern?.colors_measured.length
        ? `<h3>Краски — ${a.pattern.colors_measured.length} ` +
          `${a.pattern.colors_measured.length === 1 ? 'сетка' : 'сеток'}</h3>` +
          `<table><tbody>` +
          a.pattern.colors_measured
            .map(
              (c) =>
                `<tr><td style="width:8mm"><span class="swatch" ` +
                `style="background:${esc(c.hex)}"></span></td>` +
                `<td class="mono">${esc(c.hex)}</td>` +
                `<td class="num v">${Math.round(c.share * 100)}%</td>` +
                `<td class="note">${c.book_code ? esc(c.book_code) + (c.delta_e !== null ? ` · ΔE ${num(c.delta_e)}` : '') : 'номер по каталогу не подобран'}</td></tr>`,
            )
            .join('') +
          `</tbody></table>` +
          `<div class="note" style="margin-top:2mm">Доля площади задаёт расход краски. ` +
          `Цвета измерены по пикселям тайла, а не подобраны на глаз. ` +
          `${esc(a.pattern.vector_verdict_ru)}</div>`
        : '') +
      (a.warnings_ru.length
        ? `<h3>Ограничения</h3><ul class="plain">` +
          a.warnings_ru.map((w) => `<li>${esc(w)}</li>`).join('') +
          `</ul>`
        : '') +
      `</div>` +
      `<div>` +
      `<h3 style="margin-top:0">Проверка макета</h3>` +
      `<table><tbody>${checks}</tbody></table>` +
      `<div class="note" style="margin-top:4mm">● годится · ▲ обратите внимание · ` +
      `■ печатать нельзя. Это те же вопросы, которые печатник задал бы письмом: ` +
      `в каких сантиметрах печатать, хватит ли разрешения, что с фоном.</div>` +
      `</div>` +
      `</div>`
    );
  });

  const tile = visuals?.patternTile;
  const allover = artwork.placements.find((a) => a.kind === 'allover');
  if (tile && allover && safeDataUri(tile.dataUri)) {
    const flats = renderFlatsFromSpec(spec, {
      layers: ['pattern', 'outline', 'seams', 'stitches'],
      patternFill: { dataUri: tile.dataUri, repeatCm: tile.repeatCm },
    });
    pages.push(
      `<h2>Как раппорт ляжет на изделие</h2>` +
        `<div class="flat">` +
        `<figure>${flats.front.svg}<figcaption>Перед</figcaption></figure>` +
        `<figure>${flats.back.svg}<figcaption>Спинка</figcaption></figure>` +
        `</div>` +
        `<div class="note" style="margin-top:3mm">Шаг раппорта здесь РАЗМЕРНО ТОЧЕН: ` +
        `чертёж построен в сантиметрах, поэтому ${num(allover.size_cm.width.value)} см ` +
        `на изделии дают ${num(allover.size_cm.width.value)} см на рисунке — видно, ` +
        `каким мотив выйдет в жизни. ` +
        `<span class="flag">не для замеров</span> Раскладка мотивов на готовом изделии ` +
        `зависит от раскроя и совпадёт не в точности: рисунок непрерывен по полотну, ` +
        `а не по контуру детали.</div>`,
    );
  }

  return pages;
}

/**
 * Фотореалистичный раппорт на изделии.
 *
 * Вторая половина ответа на вопрос «как это будет выглядеть». Первая —
 * размерно точная раскладка на схеме нанесения: там видно, каким мотив
 * выйдет в сантиметрах. Здесь видно, как он ляжет на складках и как
 * прочитается фактура.
 *
 * Правила страницы внешнего вида наследуются целиком, и главное из них
 * стоит прямо на листе: размеры отсюда не снимаются. Обе картинки нужны
 * порознь именно потому, что каждая врёт в том, в чём сильна другая:
 * схема точна в сантиметрах и ничего не говорит о драпировке, фотореализм
 * показывает драпировку и не даёт мерить.
 */
function patternPreviewBody(spec: StyleSpec, visuals?: DocVisuals): string | null {
  const render = visuals?.patternRender;
  const allover = spec.artwork?.placements.find((a) => a.kind === 'allover');
  if (!render || !allover || !safeDataUri(render.dataUri)) return null;

  // Кадр портретный, а лист альбомный: колонка во всю ширину дала бы
  // картинку в центре и две пустые трети по бокам. Ограничиваем ширину
  // и центрируем — так лист занят изображением, а не полями.
  return (
    `<div class="preview single">` +
    `<figure><div class="frame"><img src="${safeDataUri(render.dataUri)}" alt=""></div>` +
    `<figcaption>Раппорт на изделии · шаг ${num(allover.size_cm.width.value)} см · ` +
    `<span class="flag">не для замеров</span></figcaption></figure>` +
    `</div>` +
    `<div class="note" style="margin-top:3mm">Визуализация построена из данных этого ` +
    `документа и приложенного тайла: показывает, как рисунок ложится на складках ` +
    `и как читается фактура полотна. <b>Размерно точная раскладка — на схеме ` +
    `нанесения</b>: там шаг раппорта отложен в сантиметрах, и по ней сверяют масштаб ` +
    `мотива. Здесь масштаб приблизительный, а раскладка на готовом изделии зависит ` +
    `от раскроя.</div>`
  );
}

// ---------------------------------------------------------------- чертёж

function flatsBody(flats: { front: { svg: string }; back: { svg: string } }): string {
  // Никаких таблиц на этой странице: один смысловой блок — один лист.
  // Воздух здесь работает — чертёж читают, а не проглядывают.
  return (
    `<div class="canvas">` +
    `<div class="ml">Технический чертёж · масштаб не соблюдён, размеры в табеле мер</div>` +
    `<figure>${flats.front.svg}<figcaption class="ml">Перед</figcaption></figure>` +
    `<figure>${flats.back.svg}<figcaption class="ml">Спинка</figcaption></figure>` +
    `</div>` +
    `<div class="note" style="margin-top:3mm">Чертёж построен из таблицы замеров: правка ` +
    `значения перестраивает геометрию. Число пунктирных линий равно числу параллельных ` +
    `строчек — по нему определяется тип машины.</div>`
  );
}

// ---------------------------------------------------------------- табель мер

/**
 * Правила приёмки под табелем мер.
 *
 * Допуск в колонке — не весь договор о приёмке. ГОСТ 23193-78 добавляет два
 * правила, которые поточечное число не выражает: погрешность самого измерения
 * и суммирование отклонений парных деталей. Без них ОТК принимает изделие
 * с левым рукавом длиннее правого на сантиметр, потому что каждый рукав
 * по отдельности в допуске.
 *
 * Строка про сравнение с мировой нормой — не хвастовство, а снятие вопроса,
 * который фабрика задаёт первым: «почему у вас допуски уже, чем мы привыкли».
 */
function acceptanceNote(pro: boolean): string {
  const base =
    `<div class="note" style="margin-top:4mm">Замеры сняты с изделия в плоском виде. ` +
    `Крупные ширины даны как половина обхвата. Допуск — предельное отклонение ` +
    `при приёмке ОТК, по <b>ГОСТ 23193-78</b>. По точкам, которых стандарт ` +
    `не описывает — высота бейки, пояса и манжеты, — допуск взят из практики ` +
    `и объяснён в примечании к значению.`;

  if (!pro) return `${base}</div>`;

  return (
    `${base} Он равен или строже международной фабричной практики ` +
    `(±2.0 по ширине и длине) и китайского сорта 合格品 (±1.5) — документ ` +
    `не требует ничего сверх привычного, он требует точнее.` +
    `<br><b>Два правила приёмки, которых нет в колонке допуска:</b> ` +
    `погрешность самого измерения ±1 мм — отклонение в пределах миллиметра ` +
    `отклонением не считается; для парных деталей сумма отклонений ` +
    `<b>в разные стороны</b> не должна превышать допуск — левый рукав +0.4 ` +
    `и правый −0.4 при допуске ±0.5 это брак, хотя каждый по отдельности ` +
    `в допуске.</div>`
  );
}

function measurementsPages(spec: StyleSpec, pro: boolean): string[] {
  const graded = spec.base.size_range.filter((ru) => ru !== spec.base.base_size_ru);
  const points = spec.measurements.points.filter((p) => pro || !p.pro_only);

  // Примечания нумеруются ОДИН раз на весь табель и печатаются сносками
  // под таблицей. В ячейке остаётся только номер: калибровка добавляет
  // одну и ту же строку ко всем точкам, и восемнадцать одинаковых
  // примечаний в колонке топят в шуме те, ради которых блок существует.
  const footnotes = groupNotes(points);
  const noteNumber = new Map<string, number>();
  footnotes.forEach((n, i) => noteNumber.set(n.text, i + 1));

  const head =
    `<tr><th>Код</th><th>Точка измерения</th><th>Как мерить</th>` +
    `<th class="num">RU ${spec.base.base_size_ru}</th><th class="num">Допуск</th>` +
    `<th class="mark" title="Статус значения">●</th>` +
    graded.map((ru) => `<th class="num">${ru}</th>`).join('') +
    `</tr>`;

  const tablePages = chunk(points, ROWS_PER_PAGE.measurements).map((rows, i, all) => {
    const body = rows
      .map((p) => {
        const byRu = new Map(p.graded.map((g) => [g.ru, g.value.value]));
        const ref = p.base.note ? noteNumber.get(p.base.note) : undefined;
        return (
          `<tr${p.pro_only ? ' class="pro"' : ''}>` +
          `<td class="mono">${p.code}</td><td>${esc(p.name_ru)}</td>` +
          `<td class="note">${esc(p.how_to_measure_ru)}</td>` +
          `<td class="num v nowrap">${num(p.base.value)}` +
          (ref ? `<sup class="fn-ref">${ref}</sup>` : '') +
          `</td>` +
          `<td class="num v">±${num(p.tolerance.value)}</td>` +
          `<td class="mark"><span class="dot dot-${p.base.confidence}" ` +
          `title="${esc(CONFIDENCE_LABEL_RU[p.base.confidence])}"></span></td>` +
          graded
            .map((ru) => `<td class="num v">${byRu.has(ru) ? num(byRu.get(ru)!) : '—'}</td>`)
            .join('') +
          `</tr>`
        );
      })
      .join('');

    const isLast = i === all.length - 1;
    return (
      `<table><thead>${head}</thead><tbody>${body}</tbody></table>` +
      (isLast ? acceptanceNote(pro) : '')
    );
  });

  // Сноски идут отдельным листом только если их слишком много для подвала.
  // Всё, что помещается, печатается прямо под таблицей — там его и ищут.
  const notePages = chunk(footnotes, ROWS_PER_PAGE.notes).map(
    (group, i) =>
      (i === 0 ? `<h2>Примечания к значениям</h2>` : '') +
      `<div class="fn"><ol>` +
      group
        .map((n) => `<li value="${noteNumber.get(n.text)}"><b>${n.codes}</b> — ${esc(n.text)}</li>`)
        .join('') +
      `</ol></div>`,
  );

  const pages = [...tablePages, ...notePages];
  return pages.length ? pages : [`<div class="note">Табель мер пуст.</div>`];
}

/**
 * Группировка примечаний по тексту.
 *
 * Одинаковое примечание у многих точек печатается один раз со списком кодов:
 * «T02, T04, T05 … — масштаб откалиброван по вашему замеру». Если точек больше
 * восьми, перечисление кодов теряет смысл — пишем «у всех остальных точек».
 */
function groupNotes(
  points: readonly StyleSpec['measurements']['points'][number][],
): { codes: string; text: string }[] {
  const byText = new Map<string, string[]>();
  for (const p of points) {
    if (!p.base.note) continue;
    byText.set(p.base.note, [...(byText.get(p.base.note) ?? []), p.code]);
  }

  return [...byText.entries()]
    .sort((a, b) => a[1].length - b[1].length)
    .map(([text, codes]) => ({
      codes: codes.length > 8 ? `${codes.length} точек` : codes.join(', '),
      text,
    }));
}

// ---------------------------------------------------------------- материалы

function bomPages(spec: StyleSpec): string[] {
  const bom = spec.bom;
  if (!bom) return [];

  const colorways = bom.colorways
    .map(
      (c) =>
        `<span style="margin-right:6mm">` +
        (c.hex_approx
          ? `<span class="swatch" style="background:${esc(c.hex_approx)}"></span>`
          : '') +
        `${esc(c.name_ru)}</span>`,
    )
    .join('');

  const head =
    `<tr><th>Код</th><th>Позиция</th><th>Назначение</th><th>Состав</th>` +
    `<th class="num">г/м²</th><th class="num">Расход</th><th>Артикул поставщика</th></tr>`;

  return chunk(bom.lines, ROWS_PER_PAGE.bom).map((lines, i, all) => {
    const rows = lines
      .map(
        (l) =>
          `<tr><td class="mono">${l.code}</td><td>${esc(l.name_ru)}</td>` +
          `<td class="note">${esc(l.placement_ru)}</td>` +
          `<td>${value(l.composition)}</td>` +
          `<td class="num">${l.gsm ? value(l.gsm) : '—'}</td>` +
          `<td class="num v">${l.consumption ? `${num(l.consumption.value)} ${l.consumption_unit}` : '—'}</td>` +
          `<td class="note">${l.supplier_article ?? 'уточняется у поставщика'}</td></tr>`,
      )
      .join('');

    const isLast = i === all.length - 1;
    return (
      (i === 0
        ? `<div class="note" style="margin-bottom:3mm"><b>Колорвеи:</b> ${colorways}</div>`
        : '') +
      `<table><thead>${head}</thead><tbody>${rows}</tbody></table>` +
      (isLast
        ? `<h3>Расход основного полотна</h3>` +
          `<div style="font-size:18pt;font-weight:700">${value(bom.fabric_consumption_m)}` +
          `<span class="v"> м</span>` +
          (bom.batch_consumption_m
            ? `<span class="note" style="margin-left:6mm">на тираж: ${num(bom.batch_consumption_m)} м</span>`
            : '') +
          `</div>` +
          `<div class="note warn" style="margin-top:2mm">${esc(bom.fabric_consumption_m.note ?? '')}</div>` +
          artworkCostLine(spec)
        : '')
    );
  });
}

/**
 * Нанесение в спецификации — отдельной строкой, а не строкой материала.
 *
 * Соблазн был положить печать в ту же таблицу: тогда «всё в одном месте».
 * Но строка материала обязана нести состав, плотность и расход в метрах,
 * а у печати нет ни одного из трёх: это операция подрядчика, а не материал.
 * Подделать три поля ради общей таблицы значит соврать в трёх полях сразу.
 *
 * Фабрике при этом строка нужна: она считает цену изделия, и нанесение
 * в эту цену входит.
 */
function artworkCostLine(spec: StyleSpec): string {
  if (!spec.artwork) return '';
  const rows = spec.artwork.placements
    .map(
      (a) =>
        `<tr><td class="mono">${esc(a.id)}</td>` +
        `<td>${esc(a.zone_label_ru)}</td>` +
        `<td>${esc(a.technique_label_ru)}</td>` +
        `<td class="num v">${num(a.size_cm.width.value)} × ${num(a.size_cm.height.value)}</td>` +
        `<td class="num v">${a.colors.model === 'full' ? 'полноцвет' : num(a.colors.count?.value ?? 1)}</td></tr>`,
    )
    .join('');

  return (
    `<h3>Нанесение</h3>` +
    `<table><thead><tr><th>Код</th><th>Зона</th><th>Техника</th>` +
    `<th class="num">Размер, см</th><th class="num">Цветов</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<div class="note" style="margin-top:2mm">Нанесение — операция отдельного ` +
    `подрядчика, а не материал: состава, плотности и расхода в метрах у него нет, ` +
    `поэтому в таблице материалов ему не место. В цену изделия оно входит — ` +
    `спецификация для печатника выгружается отдельным листом.</div>`
  );
}

// ---------------------------------------------------------------- конструкция

function constructionPages(spec: StyleSpec, pro: boolean): string[] {
  const c = spec.construction;
  if (!c) return [];

  const machine = (m: string): string => MACHINE_LABEL_RU[m as MachineType] ?? m;

  const nodeHead =
    `<tr><th>№</th><th>Зона</th><th>Узел обработки</th>` +
    (pro ? `<th>Шов / стежок</th><th class="num">SPI</th><th>Оборудование</th>` : '') +
    `<th class="num">Припуск</th><th class="mark">●</th></tr>`;

  const nodePages = chunk(c.nodes, ROWS_PER_PAGE.nodes).map((nodes, page) => {
    const rows = nodes
      .map((n, i) => {
        const number = page * ROWS_PER_PAGE.nodes + i + 1;
        return (
          `<tr><td class="num mono">${number}</td>` +
          `<td class="note">${ZONE_LABEL_RU[n.zone as NodeZone] ?? esc(n.zone)}</td>` +
          `<td><b>${esc(n.label_ru)}</b>` +
          (n.requires_special_equipment ? ` <span class="flag">спецоборудование</span>` : '') +
          `<div class="note">${esc(n.plain_ru)}</div>` +
          (n.alternative
            ? `<div class="note warn">Замена под базовый парк цеха: ${esc(n.alternative.label_ru)} ` +
              `(${esc(machine(n.alternative.machine))})</div>`
            : '') +
          `</td>` +
          (pro
            ? `<td class="mono">${n.seam_code}/${n.stitch_code}</td>` +
              `<td class="num mono">${n.spi}</td>` +
              `<td class="note">${esc(machine(n.machine))}</td>`
            : '') +
          `<td class="num v">${num(n.seam_allowance_cm.value)}</td>` +
          `<td class="mark"><span class="dot dot-${n.presence.confidence}" ` +
          `title="${esc(CONFIDENCE_LABEL_RU[n.presence.confidence])}"></span></td></tr>`
        );
      })
      .join('');

    return `<h2>Узлы обработки</h2><table><thead>${nodeHead}</thead><tbody>${rows}</tbody></table>`;
  });

  const seqPages = chunk(c.sequence, ROWS_PER_PAGE.sequence).map((steps, i, all) => {
    const rows = steps
      .map(
        (s) =>
          `<tr><td class="num mono">${s.step}</td><td>${esc(s.operation_ru)}</td>` +
          `<td class="mono" title="${SPECIALTY_LABEL_RU[s.specialty as Specialty] ?? ''}">${s.specialty}</td>` +
          `<td class="note">${esc(machine(s.machine))}</td>` +
          `<td class="num v">${s.time_sec ?? '—'}</td></tr>`,
      )
      .join('');

    return (
      `<h2>Технологическая последовательность</h2>` +
      `<table><thead><tr><th>№</th><th>Неделимая операция</th><th>Спец.</th>` +
      `<th>Оборудование</th><th class="num">Время, с</th></tr></thead><tbody>${rows}</tbody></table>` +
      (i === all.length - 1
        ? `<div class="note" style="margin-top:3mm">Специальности: ` +
          (Object.entries(SPECIALTY_LABEL_RU) as [Specialty, string][])
            .map(([k, v]) => `${k} — ${v}`)
            .join(', ') +
          `. Нормы времени проставляет фабрика по своему цеху.</div>`
        : '')
    );
  });

  return [...nodePages, ...seqPages];
}

// ---------------------------------------------------------------- маркировка

function labelsPages(spec: StyleSpec): string[] {
  const l = spec.labels;
  if (!l) return [];

  const requisites = l.requisites
    .map(
      (r) =>
        `<tr><td>${esc(r.label_ru)}${r.required ? ' <span class="v">*</span>' : ''}</td>` +
        `<td>${
          r.value
            ? value(r.value)
            : `<span class="flag">не заполнено</span> <span class="note">${esc(r.action_ru ?? '')}</span>`
        }</td></tr>`,
    )
    .join('');

  const care = l.care_symbols.map((s) => esc(s.label_ru)).join(' · ');

  const first =
    `<div class="grid2">` +
    `<div><h2>Обязательные реквизиты</h2>` +
    `<table><tbody>${requisites}</tbody></table>` +
    `<div class="note" style="margin-top:2mm">* обязательно по статье 9 ТР ТС 017/2011. ` +
    `Все надписи — на русском языке, на изделии, этикетке, ярлыке или упаковке.</div></div>` +
    `<div><h2>Символы ухода</h2>` +
    `<div class="card"><div class="note">${care}</div></div>` +
    `<div class="note" style="margin-top:2mm">Порядок символов по ГОСТ ISO 3758: стирка, ` +
    `отбеливание, сушка, глажение, профессиональная чистка. Режим ухода зависит от ` +
    `конкретного полотна — подтвердите у поставщика.</div></div>` +
    `</div>`;

  const skuPages = chunk(l.sku_matrix, ROWS_PER_PAGE.sku).map((rows, i, all) => {
    const body = rows
      .map(
        (s) =>
          `<tr><td class="mono">${esc(s.sku)}</td><td>${esc(s.colorway_ru)}</td>` +
          `<td class="num">${s.size_ru}</td><td class="note">присваивается в Нацкаталоге</td></tr>`,
      )
      .join('');
    return (
      `<h2>Матрица артикулов</h2>` +
      `<table><thead><tr><th>Артикул</th><th>Цвет</th><th class="num">Размер</th>` +
      `<th>Код маркировки (GTIN)</th></tr></thead><tbody>${body}</tbody></table>` +
      (i === all.length - 1
        ? `<div class="note" style="margin-top:3mm">Коды GTIN бренд получает в Нацкаталоге ` +
          `самостоятельно — мы оставляем плейсхолдеры. Атрибуты карточки Нацкаталога почти ` +
          `полностью совпадают с реквизитами ярлыка выше.</div>`
        : '')
    );
  });

  return [first, ...skuPages];
}

// ---------------------------------------------------------------- лекала

function patternsBody(): string {
  return (
    `<div class="placeholder">` +
    `<div class="kicker">Лекала, градация, раскладка</div>` +
    `<div style="font-size:13pt;font-weight:700">Предоставляются конструктором</div>` +
    `<div class="note" style="max-width:150mm">Мы не строим лекала и не делаем раскладку — ` +
    `это работа конструктора по этому документу. Табель мер с допусками, узлы обработки ` +
    `и технологическая последовательность даны полностью, поэтому конструктор и фабрика ` +
    `могут работать без дополнительных вопросов к заказчику.</div>` +
    `<div class="note">Расход полотна в разделе материалов — предварительный: точное ` +
    `значение считается по раскладке на конкретный размерный ряд.</div>` +
    `</div>`
  );
}
