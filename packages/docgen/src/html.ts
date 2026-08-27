import { CONFIDENCE_LABEL_RU, CONFIDENCE_LEVELS, type Confidence } from '@seamsterly/core';
import { flatDefaults, renderFlatsFromSpec } from '@seamsterly/flats';
import {
  CATEGORY_LABEL_RU,
  FIT_INTENT_LABEL_RU,
  MACHINE_LABEL_RU,
  SPECIALTY_LABEL_RU,
  ZONE_LABEL_RU,
  type Category,
  type FitIntent,
  type MachineType,
  type Gender,
  type NodeZone,
  type Specialty,
  kb,
  CATEGORY_LABEL_EN,
  CATEGORY_LABEL_ZH,
  FIT_INTENT_LABEL_EN,
  FIT_INTENT_LABEL_ZH,
  MACHINE_LABEL_EN,
  MACHINE_LABEL_ZH,
  MATERIAL_ROLE_LABEL_EN,
  MATERIAL_ROLE_LABEL_ZH,
  ZONE_LABEL_EN,
  ZONE_LABEL_ZH,
} from '@seamsterly/kb';
import type { StyleSpec } from '@seamsterly/stylespec';
import type { SpecDiff } from '@seamsterly/versions';
import { messages, type Locale, type Messages } from '@seamsterly/i18n';
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
  'changes',
  'preview',
  'flats',
  'measurements',
  'grading',
  'bom',
  'colorways',
  'construction',
  'artwork',
  'pattern_preview',
  'labels',
  'patterns',
] as const;
export type DocSection = (typeof DOC_SECTIONS)[number];

/**
 * Разделы, переведённые ЦЕЛИКОМ.
 *
 * Нерусский комплект собирается только из них. Причина не в лени, а в том,
 * что остальные разделы несут доменный текст, которого на английском
 * и китайском у нас пока нет: названия узлов обработки, материалы, символы
 * ухода, тексты проверок печати. Напечатать их по-русски в китайском техпаке
 * значило бы отдать фабрике лист, половина которого ей недоступна, — она
 * напишет письмо и будет ждать ответа сутки.
 *
 * Отсутствующий раздел честнее нечитаемого. На обложке сказано, каких
 * разделов нет и почему.
 */
export const TRANSLATED_SECTIONS: readonly DocSection[] = [
  'cover',
  'flats',
  'measurements',
  'grading',
  'bom',
  'colorways',
  'construction',
  'artwork',
  'labels',
];

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
/** Набор видов из библиотеки на одном языке. */
export interface LibraryFlatViews {
  front: { svg: string; viewBox: { width: number } };
  back?: { svg: string; viewBox: { width: number } };
  /** Идентификатор шаблона — попадает в подпись и в выгрузку исходников. */
  templateId: string;
  /**
   * Зоны, которых на силуэте не нашлось.
   *
   * Узел обработки у изделия есть, а деталь силуэт не рисует. Выноску на
   * пустое место не ставим — но и молчать нельзя: технолог обязан узнать,
   * что карман на иллюстрации не показан, а не искать его глазами.
   */
  missing?: readonly NodeZone[];
}

export interface DocVisuals {
  /** Визуализация изделия из спеки. Превью, не источник размеров. */
  render?: DocImage;
  /** Снимки, которые прислал заказчик. */
  photos?: readonly DocImage[];
  /**
   * Готовые виды из библиотеки силуэтов — по одному набору на язык.
   *
   * Заданы — раздел чертежа показывает их вместо параметрического
   * построения. Такой силуэт масштабирован под габарит, но не деформирован
   * под каждый замер, поэтому приходит уже с плашкой и без выносок на
   * размерные точки; лист об этом говорит прямо.
   *
   * По языкам, а не одним набором: плашка вшита в сам SVG, и русская
   * оговорка в китайском комплекте так же бесполезна, как русский абзац
   * под чертежом — фабрика её просто не прочтёт.
   */
  libraryFlats?: Partial<Record<Locale, LibraryFlatViews>>;
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
  /**
   * Образцы полотна, присланные брендом, — по идентификатору колорвея.
   *
   * Показываются как есть, без обработки: это снимок того, что бренд держал
   * в руках, и подкрашивать его значило бы подменить единственный
   * вещественный вход по цвету.
   */
  swatches?: Readonly<Record<string, DocImage>>;
  /**
   * Фотореалистичное изделие в цвете колорвея — по идентификатору.
   * Те же правила, что у страницы внешнего вида: не для замеров, кэш,
   * вне цеховых выгрузок.
   */
  colorwayRenders?: Readonly<Record<string, DocImage>>;
}

export interface HtmlOptions {
  /** Какие страницы включить. По умолчанию все. */
  sections?: readonly DocSection[];
  /** Pro-режим раскрывает плотность: коды ГОСТ, SPI, техпоследовательность. */
  pro?: boolean;
  /** Подпись роли в колонтитуле — для выгрузок по ролям. */
  roleLabel?: string;
  visuals?: DocVisuals;
  /**
   * Язык комплекта. По умолчанию русский.
   *
   * Нерусский комплект — ФАБРИЧНЫЙ: в нём разделы, которые фабрика читает,
   * и нет длинных пояснений о происхождении значений. Они написаны для
   * бренда и по-русски; печатать их русским текстом в китайском техпаке
   * значило бы заставить фабрику писать письмо и ждать ответа сутки.
   */
  locale?: Locale;
  /**
   * Что изменилось с прошлой версии.
   *
   * Передаётся снаружи, потому что чтение истории — это ввод-вывод, а рендер
   * документа обязан оставаться чистой функцией спеки.
   */
  changes?: { from_version: number; to_version: number; diff: SpecDiff };
}

/**
 * Сколько строк помещается на лист A4 в альбомной ориентации.
 * Значения подобраны по факту печати с запасом на перенос текста в ячейках.
 */
const ROWS_PER_PAGE = {
  measurements: 15,
  notes: 17,
  bom: 11,
  nodes: 7,
  sequence: 17,
  sku: 17,
  changes: 12,
  grading: 15,
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
  const locale = options.locale ?? 'ru';
  const sections = options.sections ?? (locale === 'ru' ? DOC_SECTIONS : TRANSLATED_SECTIONS);
  const pro = options.pro ?? false;
  const include = (s: DocSection): boolean => sections.includes(s);

  const t = messages(locale);
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

  add('cover', t.section_cover, [coverBody(spec, t, locale)]);
  // Лист изменений идёт СРАЗУ за обложкой: человек, который уже читал прошлую
  // версию, не станет перечитывать сорок страниц ради двух правок. Без этого
  // листа «версия 2» означает «читайте всё заново», и её просто не читают.
  if (options.changes && include('changes')) {
    add('changes', t.section_changes, changesPages(options.changes));
  }
  // Страницы внешнего вида нет, если показывать нечего: пустой лист
  // с рамками хуже отсутствующего раздела. Тело собирается только когда
  // раздел действительно нужен — в нём мегабайты data-URI.
  if (include('preview')) {
    const preview = previewBody(spec, options.visuals);
    if (preview) add('preview', t.section_preview, [preview]);
  }
  if (include('flats')) {
    // Своего языка нет — берём русский набор: чертёж без плашки на нужном
    // языке всё равно лучше, чем отсутствие чертежа.
    const byLocale = options.visuals?.libraryFlats;
    const library = byLocale ? (byLocale[locale] ?? byLocale.ru) : undefined;
    add('flats', t.section_flats, [
      library
        ? libraryFlatsBody(library, t, locale)
        : flatsBody(
            spec,
            renderFlatsFromSpec(spec, { ...flatDefaults(spec), ...viewLabels(t) }),
            t,
            locale,
          ),
    ]);
  }
  add('measurements', t.section_measurements, measurementsPages(spec, pro, t, locale));
  add('grading', t.section_grading, gradingPages(spec, pro, t, locale));
  add('bom', t.section_bom, bomPages(spec, t, locale));
  if (include('colorways')) {
    const bodies = colorwayPages(spec, t, locale, options.visuals);
    if (bodies.length) add('colorways', t.section_colorways, bodies);
  }
  add('construction', t.section_construction, constructionPages(spec, pro, t, locale));
  if (spec.artwork)
    add('artwork', t.section_artwork, artworkPages(spec, spec.artwork, t, locale, options.visuals));
  // Фотореалистичное превью раппорта — ОТДЕЛЬНЫЙ раздел, а не третий лист
  // нанесения. Разделы это единица ролевой выгрузки: цеху и печатнику
  // такая картинка не нужна и только отвлекает от размерной раскладки.
  if (include('pattern_preview')) {
    const body = patternPreviewBody(spec, options.visuals);
    if (body) add('pattern_preview', t.section_pattern_preview, [body]);
  }
  add('labels', t.section_labels, labelsPages(spec, t, locale));
  add('patterns', t.section_patterns, [patternsBody()]);

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
  const t = messages(options.locale ?? 'ru');
  const brand = spec.style.brand?.trim();
  const part = page.part ? ` · ${t.sheet_of(page.part.index, page.part.total)}` : '';

  const meta: [string, string][] = [
    [t.meta_brand, brand ? esc(brand) : `<span class="tbc">${esc(t.meta_empty_brand)}</span>`],
    [t.meta_model, esc(spec.style.name)],
    [t.meta_article, esc(spec.style.article)],
    [
      t.meta_season,
      spec.style.season
        ? esc(spec.style.season)
        : `<span class="tbc">${esc(t.meta_empty_season)}</span>`,
    ],
    [
      t.meta_base_size,
      // Для китайской фабрики базовый размер — это 号型, а не «RU 46»:
      // российский номер ей ни о чём не говорит, а 165/92A задаёт рост,
      // обхват груди и полнотную группу разом. RU остаётся рядом — по нему
      // сверяются с российским брендом.
      `RU ${spec.base.base_size_ru}` +
        (options.locale === 'zh'
          ? (() => {
              const hao = kb().sizeLabelFor(
                spec.base.gender as Gender,
                spec.base.base_size_ru,
                'cn',
              );
              return hao ? ` · ${esc(hao)}` : '';
            })()
          : '') +
        ` · ${esc(t.meta_height)} ${num(spec.base.base_height_cm)}`,
    ],
    [
      t.meta_version,
      `${esc(spec.spec_version)}${spec.bom?.batch_qty ? ` · ${spec.bom.batch_qty} ${esc(t.meta_qty)}` : ''}`,
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
    `<span class="legend">${statusLegend(t)}</span>` +
    `<span>${esc(t.sheet_of(index, total))}</span>` +
    `</div></section>`
  );
}

/**
 * Название точки на языке комплекта.
 *
 * Русский и английский есть всегда, китайский появился со схемой 0.8.0.
 * Если перевода нет — печатается АНГЛИЙСКОЕ название, а не русское:
 * английские названия точек это отраслевая номенклатура, её читает
 * любая фабрика. Русское слово в китайском листе не прочтёт никто.
 */
function pointName(p: StyleSpec['measurements']['points'][number], t: Messages): string {
  if (t === messages('ru')) return p.name_ru;
  if (t === messages('zh')) {
    const name = p.name_zh ?? p.name_en;
    // 胸围 по-китайски — ПОЛНЫЙ обхват груди. Наш замер — половина в
    // плоском виде, и фабрика прочтёт 92 там, где мы написали 46. В
    // китайских техпаках это пишут явно: 1/2胸围. Правило, а не правка
    // каждого имени: признак половины лежит в самой точке, и новая точка
    // не сможет о нём забыть.
    return p.measure_kind === 'half' && !name.startsWith('1/2') ? `1/2${name}` : name;
  }
  return p.name_en;
}

function pointHow(p: StyleSpec['measurements']['points'][number], t: Messages): string {
  if (t === messages('ru')) return p.how_to_measure_ru;
  if (t === messages('zh'))
    return p.how_to_measure_zh ?? p.how_to_measure_en ?? p.how_to_measure_ru;
  return p.how_to_measure_en ?? p.how_to_measure_ru;
}

/** Заглушка всегда говорит, что сюда придёт и откуда. */
function tbc(source: string): string {
  return `<span class="tbc">[не заполнено — ${esc(source)}]</span>`;
}

/** Мини-легенда статусов в футере: она нужна на каждом листе, а не только на первом. */
function statusLegend(t: Messages): string {
  return LEGEND.map(
    ([c]) =>
      `<span class="legend-item"><span class="dot dot-${c}"></span>` +
      `${esc(statusLabel(t, c))}</span>`,
  ).join('');
}

/** Подпись статуса на языке комплекта. */
function statusLabel(t: Messages, c: Confidence): string {
  return {
    fit_confirmed: t.status_fit_confirmed,
    user_input: t.status_user_input,
    measured_by_scale: t.status_measured_by_scale,
    estimated_from_photo: t.status_estimated_from_photo,
    default_from_base: t.status_default_from_base,
    assumption: t.status_assumption,
  }[c];
}

// ---------------------------------------------------------------- обложка

const LEGEND: [Confidence, string][] = [
  ['fit_confirmed', 'снято с отшитого образца'],
  ['user_input', 'сообщил заказчик'],
  ['estimated_from_photo', 'получено из пропорций на снимке'],
  ['default_from_base', 'взято из отраслевого справочника'],
  ['assumption', 'подтвердить по образцу до запуска партии'],
];

function coverBody(spec: StyleSpec, t: Messages, locale: Locale): string {
  if (locale !== 'ru') return coverFactory(spec, t, locale);

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

  const flats = renderFlatsFromSpec(spec, viewLabels(t));

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

/** Картинка из data-URI. Небезопасный источник не рисуется вовсе. */
function imgTag(image: DocImage): string {
  const src = safeDataUri(image.dataUri);
  return src ? `<img src="${src}" alt="">` : '';
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

/**
 * Номер краски и его происхождение.
 *
 * За номер, вписанный брендом, отвечает бренд: это его фирменный цвет.
 * За подобранный по каталогу отвечаем мы, и рядом обязано стоять
 * расхождение. Показать одно как другое значит переложить ответственность
 * молча.
 */
function colorCode(c: {
  book_code: string | null;
  book_source: 'brand' | 'catalog' | null;
  delta_e: number | null;
}): string {
  if (!c.book_code) return 'номер не указан — подбирается печатником по Lab';
  if (c.book_source === 'brand') return `${esc(c.book_code)} · указан брендом`;
  return esc(c.book_code) + (c.delta_e !== null ? ` · подбор, ΔE ${num(c.delta_e)}` : '');
}

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
  t: Messages,
  locale: Locale,
  visuals?: DocVisuals,
): string[] {
  const ru = locale === 'ru';
  const pick = (en: string | undefined, zh: string | undefined, fallback: string): string =>
    locale === 'en' ? (en ?? fallback) : locale === 'zh' ? (zh ?? fallback) : fallback;

  // Снапшот до 0.9.0 переводов не несёт: печатать зону и технику по-русски
  // внутри английского комплекта нельзя — фабрика прочитает половину.
  const translated =
    ru ||
    artwork.placements.every((a) =>
      locale === 'en'
        ? a.zone_label_en && a.technique_label_en
        : a.zone_label_zh && a.technique_label_zh,
    );
  if (!translated) return [];

  const pages = artwork.placements.map((a) => {
    const allover = a.kind === 'allover';
    const zoneLabel = pick(a.zone_label_en, a.zone_label_zh, a.zone_label_ru);
    const params: [string, string][] = [
      [t.art_zone, esc(zoneLabel)],
      [
        t.art_technique,
        labelled(
          a.technique,
          pick(a.technique_label_en, a.technique_label_zh, a.technique_label_ru),
        ),
      ],
      ...(allover
        ? []
        : ([
            [
              t.art_offset,
              `${value(a.offset_from_anchor_cm)} ${t.cm} ` +
                `${esc(pick(a.anchor_label_en, a.anchor_label_zh, a.anchor_label_ru))}`,
            ],
          ] as [string, string][])),
      [
        allover ? t.art_repeat_step : t.art_size,
        allover
          ? `${value(a.size_cm.width)} ${t.cm}`
          : `${value(a.size_cm.width)} × ${value(a.size_cm.height)} ${t.cm}`,
      ],
      [
        t.art_colors,
        a.colors.model === 'full'
          ? esc(t.art_colors_full)
          : `${a.colors.count ? value(a.colors.count) : '—'} ${esc(t.art_colors_spot)}` +
            (a.colors.codes.length ? ` · ${esc(a.colors.codes.join(', '))}` : ''),
      ],
      [t.art_file, a.file_name ? esc(a.file_name) : t.art_file_none],
      ...(a.pattern && ru
        ? ([
            ['Путь реализации', esc(a.pattern.path_label_ru)],
            ...(a.pattern.mirrored
              ? ([[t.art_repeat_type, t.art_repeat_mirror]] as [string, string][])
              : ([[t.art_repeat_type, t.art_repeat_straight]] as [string, string][])),
            [
              t.art_grain,
              labelled(a.pattern.grain, GRAIN_RU[a.pattern.grain.value] ?? a.pattern.grain.value),
            ],
            [
              t.art_yardage,
              a.pattern.yardage_m ? `${value(a.pattern.yardage_m)} ${t.m}` : t.art_yardage_tbd,
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
      `<h2>${esc(a.id)} · ${esc(zoneLabel)}</h2>` +
      `<div class="grid2" style="flex:1;min-height:0">` +
      `<div>` +
      `<table><tbody>` +
      params
        .map(([k, v]) => `<tr><td style="width:38mm">${esc(k)}</td><td>${v}</td></tr>`)
        .join('') +
      `</tbody></table>` +
      `<div class="note" style="margin-top:4mm">` +
      (ru
        ? allover
          ? `Шаг раппорта — та величина, которую печатник отмеряет по полотну. Без неё ` +
            `тайл можно напечатать в любом масштабе, и мотив выйдет хоть с ладонь, ` +
            `хоть с монету. ${esc(a.pattern?.path_reason_ru ?? '')}`
          : `Положение отмеряется по разложенному изделию рулеткой — от названной точки, ` +
            `а не на глаз. Границы зоны показаны на техническом чертеже пунктиром. ` +
            `Сам макет приложен файлом: на чертеже он не рисуется, потому что чертёж ` +
            `задаёт место и размер, а не изображение.`
        : esc(t.art_ru_only)) +
      `</div>` +
      (ru && a.pattern?.colors_measured.length
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
                `<td class="note">${colorCode(c)}</td></tr>`,
            )
            .join('') +
          `</tbody></table>` +
          `<div class="note" style="margin-top:2mm">Доля площади задаёт расход краски. ` +
          `Цвета измерены по пикселям тайла, а не подобраны на глаз. ` +
          `Номера вееров мы не подставляем: их подбирают по координатам Lab ` +
          `и подтверждают выкрасом. ` +
          `${esc(a.pattern.vector_verdict_ru)}</div>`
        : '') +
      (ru && a.warnings_ru.length
        ? `<h3>Ограничения</h3><ul class="plain">` +
          a.warnings_ru.map((w) => `<li>${esc(w)}</li>`).join('') +
          `</ul>`
        : '') +
      `</div>` +
      (ru
        ? `<div>` +
          `<h3 style="margin-top:0">Проверка макета</h3>` +
          `<table><tbody>${checks}</tbody></table>` +
          `<div class="note" style="margin-top:4mm">● годится · ▲ обратите внимание · ` +
          `■ печатать нельзя. Это те же вопросы, которые печатник задал бы письмом: ` +
          `в каких сантиметрах печатать, хватит ли разрешения, что с фоном.</div>` +
          `</div>`
        : '') +
      `</div>`
    );
  });

  const tile = visuals?.patternTile;
  const allover = artwork.placements.find((a) => a.kind === 'allover');
  // Название полотна рибаны берётся из спецификации, а не пишется словом:
  // если бренд заменит кашкорсе, лист обязан сказать об этом сам.
  const ribName = spec.bom?.lines.find((l) => l.role === 'rib')?.name_ru ?? 'отдельное полотно';
  if (tile && allover && safeDataUri(tile.dataUri)) {
    const flats = renderFlatsFromSpec(spec, {
      ...flatDefaults(spec),
      layers: ['pattern', 'outline', 'seams', 'stitches'],
      patternFill: { dataUri: tile.dataUri, repeatCm: tile.repeatCm },
    });
    pages.push(
      `<h2>Как раппорт ляжет на изделие</h2>` +
        `<div class="flat">` +
        viewFigure(flats.front, 'Перед') +
        viewFigure(flats.back, 'Спинка') +
        (flats.side ? viewFigure(flats.side, 'Бок') : '') +
        `</div>` +
        `<div class="note" style="margin-top:3mm">Шаг раппорта здесь РАЗМЕРНО ТОЧЕН: ` +
        `чертёж построен в сантиметрах, поэтому ${num(allover.size_cm.width.value)} см ` +
        `на изделии дают ${num(allover.size_cm.width.value)} см на рисунке — видно, ` +
        `каким мотив выйдет в жизни. ` +
        `<b>Рибаны не печатаются</b> и показаны нейтральным тоном: пояс, манжеты ` +
        `и бейка кроятся из отдельного полотна (${esc(ribName)}), и при печати ` +
        `полотна до раскроя рисунок на них не попадает — цвет-компаньон задаёт бренд. ` +
        `<b>Мотив на рукаве повёрнут по долевой детали</b>: рукав кроится вдоль своей ` +
        `длины, и на готовой вещи рисунок пойдёт вдоль рукава, а не вертикально. ` +
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

/**
 * Обложка нерусского комплекта.
 *
 * Короче русской намеренно. Сводка честности, паспорт изделия и список узлов
 * набраны доменным текстом, которого на этом языке у нас пока нет; собрать
 * их наполовину значило бы отдать фабрике лист, где часть слов ей недоступна.
 *
 * Зато здесь есть то, чего нет на русской обложке: прямая оговорка о том,
 * что это перевод и кем он не проверен. Умолчать значило бы дать фабрике
 * основание померить по нашей формулировке и предъявить нам партию.
 */
/** Паспорт изделия на фабричной обложке — только переводимые перечисления. */
function passportFactory(spec: StyleSpec, t: Messages, locale: Locale): [string, string][] {
  const category = { ru: CATEGORY_LABEL_RU, en: CATEGORY_LABEL_EN, zh: CATEGORY_LABEL_ZH }[locale];
  const fit = { ru: FIT_INTENT_LABEL_RU, en: FIT_INTENT_LABEL_EN, zh: FIT_INTENT_LABEL_ZH }[locale];
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  const rows: [string, string][] = [
    [t.cover_category, category[spec.style.category as Category]],
    [t.cover_fit, fit[spec.base.fit_intent as FitIntent]],
    [t.cover_sizes, spec.base.size_range.join(' · ')],
  ];
  if (shell) rows.push([t.cover_shell, materialName(shell, locale)]);
  return rows;
}

function coverFactory(spec: StyleSpec, t: Messages, locale: Locale): string {
  const flats = renderFlatsFromSpec(spec, { ...flatDefaults(spec), ...viewLabels(t) });
  const missing = DOC_SECTIONS.filter((x) => !TRANSLATED_SECTIONS.includes(x) && x !== 'cover');
  const label = (x: DocSection): string =>
    ({
      cover: t.section_cover,
      changes: t.section_changes,
      preview: t.section_preview,
      flats: t.section_flats,
      measurements: t.section_measurements,
      grading: t.section_grading,
      bom: t.section_bom,
      colorways: t.section_colorways,
      construction: t.section_construction,
      artwork: t.section_artwork,
      pattern_preview: t.section_pattern_preview,
      labels: t.section_labels,
      patterns: t.section_patterns,
    })[x];

  return (
    `<div class="cover">` +
    `<div class="canvas">` +
    `<div class="ml">${esc(t.section_flats)}</div>` +
    viewFigure(flats.front, t.view_front) +
    viewFigure(flats.back, t.view_back) +
    (flats.side ? viewFigure(flats.side, t.view_side) : '') +
    `</div>` +
    `<div style="display:flex;flex-direction:column;min-height:0">` +
    `<h1${spec.style.name.length > 34 ? ' style="font-size:15pt"' : ''}>` +
    `${esc(spec.style.name)}</h1>` +
    `<table class="plain"><tbody>` +
    passportFactory(spec, t, locale)
      .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`)
      .join('') +
    `</tbody></table>` +
    `<div class="note" style="margin-top:4mm">${esc(t.pom_intro)}</div>` +
    `<div style="flex:1"></div>` +
    `<div class="card warn">` +
    `<div class="ml">${esc(LOCALE_NOTICE_TITLE)}</div>` +
    `<div class="note" style="margin-top:2mm">${esc(t.translation_notice)}</div>` +
    `</div>` +
    `<div class="note" style="margin-top:3mm">${esc(RU_ONLY_TITLE)}: ` +
    `${missing.map((x) => esc(label(x))).join(' · ')}.</div>` +
    `</div></div>`
  );
}

/** Название материала на языке комплекта. */
function materialName(
  l: StyleSpec['bom'] extends undefined ? never : NonNullable<StyleSpec['bom']>['lines'][number],
  locale: Locale,
): string {
  if (locale === 'ru') return l.name_ru;
  if (locale === 'zh') return l.name_zh ?? l.name_en;
  return l.name_en;
}

/**
 * Состав на языке комплекта.
 *
 * В русском комплекте состав печатается со статусом значения: он бывает
 * предположением, и это важно. В переводе статус остаётся точкой в легенде,
 * а текст берётся переведённый — иначе состав был бы единственной русской
 * строкой в таблице.
 */
function composition(l: NonNullable<StyleSpec['bom']>['lines'][number], locale: Locale): string {
  if (locale === 'zh') return l.composition_zh ?? l.composition_en ?? l.composition.value;
  return l.composition_en ?? l.composition.value;
}

/** Подписи видов внутри SVG — на языке комплекта. */
function viewLabels(t: Messages): { viewLabels: Record<'front' | 'back' | 'side', string> } {
  return { viewLabels: { front: t.view_front, back: t.view_back, side: t.view_side } };
}

/** Подписи, одинаковые во всех языках: они называют язык, а не переводятся. */
const LOCALE_NOTICE_TITLE = 'TRANSLATION / 译文';
const RU_ONLY_TITLE = 'Issued in Russian only / 仅提供俄文';

// ---------------------------------------------------------------- градация

/**
 * Лист «Градация и приёмка».
 *
 * Таблица размеров уже стоит в табеле мер, и повторять её здесь значило бы
 * занять лист копией. У эталона именно так: страница «Grading» дублирует
 * колонки, и читать её незачем.
 *
 * Здесь другое — ПРАВИЛО, по которому таблица построена: на сколько растёт
 * каждая точка при переходе на размер вверх. По правилу фабрика может
 * проверить нашу градацию и продлить ряд за его края, чего по готовым
 * числам сделать нельзя.
 *
 * И вторая половина листа — правила приёмки, которых поточечный допуск
 * не выражает вовсе. Норма ГОСТ о ПАРНЫХ ДЕТАЛЯХ ловит несимметричность,
 * при которой каждый рукав по отдельности в допуске, а изделие — брак.
 * До сих пор этой нормы в документе не было ни строчки.
 */
function gradingPages(spec: StyleSpec, pro: boolean, t: Messages, locale: Locale): string[] {
  const base = kb();
  const template = base.pomTemplate(spec.style.category);
  const ruleOf = new Map(template.points.map((p) => [p.code, p.grading_key]));

  const sorted = [...spec.base.size_range].sort((a, b) => a - b);

  const rows: string[] = [];
  const flat: { code: string; name: string }[] = [];

  // Точки конструктора скрыты в обычном режиме — здесь так же, как в табеле.
  // Лист градации не может быть щелью, через которую в клиентский документ
  // попадает то, чего в нём нет.
  for (const point of spec.measurements.points.filter((p) => pro || !p.pro_only)) {
    if (point.graded.length === 0) {
      flat.push({ code: point.code, name: pointName(point, t) });
      continue;
    }

    // Шаг считается ИЗ ДОКУМЕНТА, а не из справочника: лист обязан описывать
    // ту таблицу, которая напечатана рядом, а не ту, которую мы собирались
    // напечатать. Разойдись они — лист покажет расхождение, а не скроет его.
    const byRu = new Map(point.graded.map((g) => [g.ru, g.value.value]));
    byRu.set(spec.base.base_size_ru, point.base.value);
    const steps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const a = byRu.get(sorted[i - 1]!);
      const b = byRu.get(sorted[i]!);
      if (a === undefined || b === undefined) continue;
      steps.push(Math.round((b - a) * 100) / 100);
    }
    if (!steps.length) continue;

    const min = Math.min(...steps);
    const max = Math.max(...steps);
    const step = min === max ? num(min) : `${num(min)}…${num(max)}`;

    const key = ruleOf.get(point.code);
    let rule = '—';
    let provenance = '';
    if (key) {
      try {
        const r = base.gradingRule(key);
        rule = locale === 'ru' ? r.label_ru : r.key;
        provenance = r.verified ? t.grading_origin_primary : t.grading_origin_expert;
      } catch {
        rule = key;
      }
    }

    rows.push(
      `<tr><td class="mono">${esc(point.code)}</td><td>${esc(pointName(point, t))}</td>` +
        `<td class="num v nowrap">+${step}</td><td>${esc(rule)}</td>` +
        `<td class="note">${esc(provenance)}</td></tr>`,
    );
  }

  const head =
    `<div class="note" style="margin-bottom:3mm">${esc(t.grading_intro)}` +
    (locale === 'ru'
      ? ` По правилу градацию можно проверить и продлить ряд за его края — ` +
        `по готовым числам этого сделать нельзя. Шаг посчитан из напечатанной ` +
        `таблицы, а не взят из справочника: лист описывает тот документ, ` +
        `который вы держите.`
      : '') +
    `</div>`;

  const table = (part: string[]): string =>
    `<table><thead><tr><th>${esc(t.pom_code)}</th><th>${esc(t.pom_point)}</th>` +
    `<th class="num">${esc(t.grading_step)}</th>` +
    `<th>${esc(t.grading_rule)}</th><th>${esc(t.grading_origin)}</th></tr></thead>` +
    `<tbody>${part.join('')}</tbody></table>`;

  const notGraded = flat.length
    ? `<h3>${esc(t.grading_not_graded)}</h3><div class="note">` +
      `${flat.map((f) => `<b>${esc(f.code)}</b> ${esc(f.name)}`).join(' · ')}.` +
      (locale === 'ru'
        ? ` Величина одинакова во всех размерах: высота рибаны и наклон плеча ` +
          `не зависят от размера, и градуировать их значило бы придумать зависимость.`
        : '') +
      `</div>`
    : '';

  // Правила приёмки — самостоятельный смысловой блок и занимают свой лист.
  // Прижать их к хвосту таблицы значило бы напечатать нормы ГОСТ в подвале.
  //
  // Тексты норм приёмки ЖИВУТ В СПРАВОЧНИКЕ и существуют только по-русски.
  // В нерусском комплекте лист остаётся, но правила заменены отсылкой:
  // печатать нормы ГОСТ русским текстом в китайском техпаке бесполезно,
  // а выдумывать их перевод — опасно, это нормативные формулировки.
  // Нормы рынка, на язык которого собран комплект. У китайской фабрики нет
  // ни доступа к ГОСТ 23193-78, ни обязанности его знать: она выпускает по
  // 执行标准 и принимает партию по AQL. Отсылка «нормы по-русски» на её
  // листе — это пустое место там, где ОТК ищет первое, что читает.
  const market = locale === 'ru' ? null : base.marketFor(locale);
  const standard = market ? base.productStandardFor(market, spec.style.category as Category) : null;
  // В чужом комплекте от пробела остаётся только флаг: объяснение написано
  // по-русски и адресовано нам, а не фабрике. Русский абзац в китайском
  // паке — это строка, которую там никто не прочтёт.
  const tbc = (v: { verified: boolean }): string =>
    v.verified ? '' : ` <span class="tbc">— ${esc(t.to_be_confirmed)}</span>`;

  const marketBlock = market
    ? `<div style="margin-bottom:3mm">` +
      `<div class="ml">${esc(market.standards_title_local)}</div>` +
      `<ul class="dash" style="margin-top:1.5mm">` +
      (standard ? `<li>${esc(standard.text_local)}${tbc(standard)}</li>` : '') +
      `<li>${esc(market.safety.text_local)}${tbc(market.safety)}</li>` +
      `<li>${esc(market.sampling.text_local)}${tbc(market.sampling)}</li>` +
      `<li>${esc(market.measurement_note_local)}</li>` +
      `</ul></div>`
    : '';

  const acceptance =
    `<h2>${esc(t.grading_acceptance_title)}</h2>` +
    `<div class="note" style="margin-bottom:3mm">${esc(t.grading_acceptance_intro)}</div>` +
    marketBlock +
    (locale !== 'ru' ? `<div class="note">GOST 23193-78 · ${esc(RU_ONLY_TITLE)}</div>` : '') +
    (locale !== 'ru' ? '' : `<ul class="dash">`) +
    (locale !== 'ru' ? [] : base.qcRules())
      .map(
        (r) =>
          `<li>${esc(r.text_ru)}` +
          (r.verified
            ? ''
            : ` <span class="tbc">— ${esc(r.gap ?? 'подлежит подтверждению')}</span>`) +
          `</li>`,
      )
      .join('') +
    (locale !== 'ru' ? '' : `</ul>`) +
    (locale !== 'ru'
      ? ''
      : `<div class="note" style="margin-top:3mm">Допуски в табеле мер даны по ` +
        `<b>ГОСТ 23193-78</b>. Для сравнения: ` +
        base
          .toleranceComparisons()
          .map((c) => esc(c.label_ru))
          .join(', ') +
        ` — по каждому классу ГОСТ строже. Мы не смягчаем допуск ради прохождения ` +
        `приёмки: на тех же машинах и том же полотне смягчение не улучшает пошив, ` +
        `а перекладывает брак на покупателя.</div>`);

  const parts = chunk(rows, ROWS_PER_PAGE.grading);
  if (!parts.length) return [head + notGraded, acceptance];

  return [
    ...parts.map(
      (part, i) => (i === 0 ? head : '') + table(part) + (i === parts.length - 1 ? notGraded : ''),
    ),
    acceptance,
  ];
}

// ---------------------------------------------------------------- изменения

/**
 * Лист «Что изменилось».
 *
 * Отвечает на единственный вопрос возвращающегося читателя: что тронули.
 * Два сорта изменений показаны РАЗДЕЛЬНО, потому что они означают разное:
 * сдвинувшееся значение требует пересмотра лекала, а поднявшийся статус
 * не требует ничего — он снимает вопрос. Свалить их в одну таблицу значило
 * бы заставить технолога вычитывать, где из этого работа.
 */
function changesPages(changes: {
  from_version: number;
  to_version: number;
  diff: SpecDiff;
}): string[] {
  const { diff, from_version, to_version } = changes;

  const head =
    `<div class="ml">версия ${from_version} → ${to_version}</div>` +
    `<h2 style="margin-top:1mm">${diff.identical ? 'Содержание не изменилось' : summariseRu(diff)}</h2>`;

  if (diff.identical) {
    return [
      head +
        `<div class="note">Документ пересобран, но ни одно значение, ни один узел ` +
        `и ни одна позиция спецификации не изменились. Работать можно по прошлой версии.</div>`,
    ];
  }

  const moved = diff.points.filter((p) => p.delta_cm !== null && p.delta_cm !== 0);
  const confirmedOnly = diff.points.filter((p) => p.confirmed && (p.delta_cm ?? 0) === 0);

  const rows = (list: SpecDiff['points']): string =>
    list
      .map(
        (p) =>
          `<tr><td class="mono">${esc(p.code)}</td><td>${esc(p.name_ru)}</td>` +
          `<td class="num v">${p.from_cm === null ? '—' : num(p.from_cm)}</td>` +
          `<td class="num v">${p.to_cm === null ? '—' : num(p.to_cm)}</td>` +
          `<td class="num v">${p.delta_cm === null ? '—' : (p.delta_cm > 0 ? '+' : '') + num(p.delta_cm)}</td>` +
          `<td class="note">${
            p.from_confidence && p.to_confidence && p.from_confidence !== p.to_confidence
              ? `${esc(CONFIDENCE_LABEL_RU[p.from_confidence])} → <b>${esc(CONFIDENCE_LABEL_RU[p.to_confidence])}</b>`
              : ''
          }</td></tr>`,
      )
      .join('');

  const table = (title: string, why: string, list: SpecDiff['points']): string =>
    list.length
      ? `<h3>${title}</h3><div class="note" style="margin-bottom:2mm">${why}</div>` +
        `<table><thead><tr><th>Код</th><th>Точка</th><th class="num">Было</th>` +
        `<th class="num">Стало</th><th class="num">Δ см</th><th>Статус</th></tr></thead>` +
        `<tbody>${rows(list)}</tbody></table>`
      : '';

  const structural = [
    ...diff.nodes.added.map((id) => `добавлен узел ${id}`),
    ...diff.nodes.removed.map((id) => `убран узел ${id}`),
    ...diff.bom.added.map((c) => `добавлена позиция ${c}`),
    ...diff.bom.removed.map((c) => `убрана позиция ${c}`),
    ...diff.colorways.added.map((c) => `добавлен цвет ${c}`),
    ...diff.colorways.removed.map((c) => `убран цвет ${c}`),
  ];

  // Изменений может оказаться много — таблица режется по листам тем же
  // правилом, что и остальные. Лист с обрезанным хвостом читается как
  // полный, и это худший сорт ошибки вёрстки.
  const blocks: string[] = [];
  chunk(moved, ROWS_PER_PAGE.changes).forEach((part, i) =>
    blocks.push(
      table(
        i === 0 ? 'Значения сдвинулись' : 'Значения сдвинулись · продолжение',
        i === 0
          ? 'Здесь работа: правка лекала, пересчёт раскладки, новый контроль на приёмке.'
          : '',
        part,
      ),
    ),
  );
  chunk(confirmedOnly, ROWS_PER_PAGE.changes).forEach((part, i) =>
    blocks.push(
      table(
        i === 0 ? 'Подтвердились без изменения' : 'Подтвердились без изменения · продолжение',
        i === 0
          ? 'Цифра прежняя, но она перестала быть догадкой. Работы не требует — снимает вопрос.'
          : '',
        part,
      ),
    ),
  );
  if (structural.length) {
    blocks.push(
      `<h3>Конструкция и спецификация</h3><ul class="dash">` +
        structural.map((x) => `<li>${esc(x)}</li>`).join('') +
        `</ul>`,
    );
  }

  const footer =
    `<div class="note" style="margin-top:3mm">Предположений в документе: ` +
    `<b>${diff.assumptions.from} → ${diff.assumptions.to}</b>. ` +
    `Прошлая версия не переписана и остаётся действительной: спор с фабрикой ` +
    `разрешается сверкой с тем файлом, который ей прислали.</div>`;

  if (!blocks.length) return [head + footer];
  return blocks.map(
    (block, i) => (i === 0 ? head : '') + block + (i === blocks.length - 1 ? footer : ''),
  );
}

/** Согласование числительного. В документе на русском это не мелочь. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Та же сводка, что в консоли, но словами документа. */
function summariseRu(diff: SpecDiff): string {
  const confirmed = diff.points.filter((p) => p.confirmed).length;
  const moved = diff.points.filter((p) => (p.delta_cm ?? 0) !== 0).length;
  const parts: string[] = [];
  if (moved)
    parts.push(
      `${moved} ${plural(moved, 'значение сдвинулось', 'значения сдвинулись', 'значений сдвинулось')}`,
    );
  if (confirmed) parts.push(`${confirmed} подтверждено по образцу`);
  return parts.join(', ') || 'изменения в конструкции и спецификации';
}

// ---------------------------------------------------------------- колорвеи

/**
 * Страница колорвеев.
 *
 * Отвечает на вопрос, которого в документе не было: как вещь выглядит
 * В ЭТОМ цвете. До сих пор цвет жил одной строчкой в спецификации, и бренд
 * узнавал ответ на образце — то есть через две недели и за деньги.
 *
 * Главное правило страницы напечатано на ней самой: это ВИЗУАЛЬНЫЙ РЕФЕРЕНС,
 * а не цветопроба. Экран, печать документа и свет при съёмке образца сдвигают
 * оттенок, и по одному кадру отличить цвет ткани от цвета лампы нельзя —
 * это свойство оптики, а не качество разбора. Точный цвет задан координатами
 * Lab и подтверждается лабдипом.
 */
function colorwayPages(
  spec: StyleSpec,
  t: Messages,
  locale: Locale,
  visuals?: DocVisuals,
): string[] {
  const ru = locale === 'ru';
  const colorways = spec.bom?.colorways ?? [];
  // Единственный безымянный цвет по умолчанию — это не колорвей, а его
  // отсутствие. Лист ради него был бы листом ни о чём.
  if (colorways.length === 0) return [];
  if (colorways.length === 1 && !colorways[0]!.swatch && !colorways[0]!.hex_approx) return [];

  const flatOf = (hex: string): string =>
    renderFlatsFromSpec(spec, {
      ...flatDefaults(spec),
      // Подписи видов внутри SVG — тоже текст документа: без локали
      // на английском листе оставалось бы «ПЕРЕД».
      ...viewLabels(t),
      layers: ['color', 'outline', 'seams'],
      colorFill: hex,
    }).front.svg;

  const cards = colorways.map((c) => {
    const sw = c.swatch;
    const hex = sw?.hex ?? c.hex_approx ?? null;
    const photo = visuals?.swatches?.[c.id];
    const render = visuals?.colorwayRenders?.[c.id];

    const origin = sw
      ? esc(t.cw_from_swatch(sw.file_name))
      : c.hex_approx
        ? esc(t.cw_from_brand)
        : esc(t.cw_not_set);

    const rows: string[] = [`<tr><td class="k">${esc(t.cw_origin)}</td><td>${origin}</td></tr>`];
    if (hex) {
      rows.push(
        `<tr><td class="k">${esc(t.cw_screen_color)}</td>` +
          `<td class="mono">${esc(hex.toUpperCase())}</td></tr>`,
      );
    }
    if (sw) {
      // Lab — язык колориста: по нему подбирают рецепт крашения.
      // По hex не подбирает никто, он для экрана.
      rows.push(
        `<tr><td class="k">${esc(t.cw_lab)}</td><td class="mono">L ${num(sw.lab.l)} · a ${num(sw.lab.a)} · ` +
          `b ${num(sw.lab.b)}</td></tr>`,
      );
    }
    if (c.book_code) {
      rows.push(
        `<tr><td class="k">${esc(t.cw_book_code)}</td><td class="mono">${esc(c.book_code)}</td>` +
          `</tr>`,
      );
    }

    const visual = render
      ? `<div class="frame">${imgTag(render)}</div>`
      : `<div class="cw-flat">${hex ? flatOf(hex) : tbc('чертёж в цвете — задайте цвет колорвея')}</div>`;

    return (
      `<div class="cw" data-colorway="${esc(c.id)}">` +
      `<div class="cw-top">` +
      (photo
        ? `<div class="cw-swatch">${imgTag(photo)}</div>`
        : hex
          ? `<div class="cw-swatch" style="background:${esc(hex)}"></div>`
          : `<div class="cw-swatch cw-empty"></div>`) +
      `<div><div class="ml">${esc(c.id)}</div><h3 style="margin:1mm 0 0">${esc(c.name_ru)}</h3>` +
      (c.book_code ? `<div class="ml" style="margin-top:1mm">${esc(t.cw_book_code)}</div>` : '') +
      `</div></div>` +
      visual +
      `<table class="plain"><tbody>${rows.join('')}</tbody></table>` +
      (sw && !sw.uniform && ru
        ? `<div class="note warn" style="margin-top:2mm">${esc(sw.verdict_ru)}</div>`
        : '') +
      `</div>`
    );
  });

  // Оговорка «это не цветопроба» обязана быть на любом языке: без неё
  // фабрика примет наш экранный цвет за эталон крашения.
  const footnote = ru
    ? `<div class="note" style="margin-top:3mm"><b>Это визуальный референс, а не ` +
      `цветопроба.</b> Экран, печать документа и свет при съёмке образца сдвигают оттенок; ` +
      `по одному кадру отличить цвет ткани от цвета лампы нельзя — это свойство оптики, ` +
      `а не качества разбора. Точный цвет задан координатами Lab в спецификации ` +
      `и подтверждается <b>лабдипом</b> — выкрасом фабрики на этом самом полотне. ` +
      `<span class="flag">не для приёмки цвета</span></div>`
    : `<div class="note" style="margin-top:3mm">${esc(t.cw_ru_only)}</div>`;

  // Колонок ровно столько, сколько карточек на листе: две карточки в сетке
  // на три оставляли бы пустую треть, и лист читался бы как недоделанный.
  return chunk(cards, 3).map(
    (group) =>
      `<div class="cw-row" style="grid-template-columns:repeat(${group.length},1fr)">` +
      `${group.join('')}</div>${footnote}`,
  );
}

// ---------------------------------------------------------------- чертёж

/**
 * Глубина изделия для бокового вида.
 *
 * Единственное место в документе, где число приходит НЕ из спеки: глубину
 * не задаёт ни один замер, она выводится из обхвата груди по сетке
 * и прибавки. Поэтому она и берётся отдельным шагом, на виду, а не прячется
 * внутрь чертежа.
 */
type Rendered = { svg: string; viewBox: { width: number }; geometry: unknown };

/**
 * Один масштаб на все виды.
 *
 * Ширины колонок относятся так же, как ширины видов в сантиметрах, — поэтому
 * бок выходит именно настолько уже переда, насколько он уже в жизни.
 * Растянутый на треть листа, он казался бы шире переда, то есть врал бы
 * ровно в том, ради чего его рисуют.
 */
function viewFigure(r: Rendered, caption: string): string {
  return (
    `<figure style="flex:${Math.round(r.viewBox.width * 100) / 100}">` +
    `${r.svg}<figcaption class="ml">${caption}</figcaption></figure>`
  );
}

/**
 * Оговорка об отведении рукава.
 *
 * Точная укладка изделия задана парой замеров однозначно, и для трикотажа
 * она даёт почти горизонтальный рукав: лист выходит вдвое шире своей высоты.
 * Отраслевой рисунок отводит рукав вниз, и ткань у проймы при этом
 * подбирается — ширина рукава НА ЧЕРТЕЖЕ выходит меньше замера.
 *
 * Об этом сказано на листе. Умолчать значило бы дать технологу право снять
 * ширину рукава с картинки.
 */
function sleeveNote(flats: { front: Rendered }): string {
  const g = flats.front.geometry as { sleeveAngle?: number; solvedSleeveAngle?: number };
  if (g.sleeveAngle === undefined || g.solvedSleeveAngle === undefined) return '';
  const drawn = Math.round((g.sleeveAngle * 180) / Math.PI);
  const solved = Math.round((g.solvedSleeveAngle * 180) / Math.PI);
  if (drawn - solved < 2) return '';
  return (
    ` Рукав отведён вниз на <b>${drawn}°</b>, как принято на техническом рисунке; ` +
    `в строго разложенном виде он ложится под ${solved}° и делает лист вдвое шире ` +
    `своей высоты. В отведённом положении ткань у проймы подбирается, поэтому ` +
    `ширина рукава на чертеже меньше замера — сам замер T12 в табеле мер.`
  );
}

function flatsBody(
  spec: StyleSpec,
  flats: { front: Rendered; back: Rendered; side?: Rendered },
  t: Messages,
  locale: Locale,
): string {
  // Никаких таблиц на этой странице: один смысловой блок — один лист.
  // Воздух здесь работает — чертёж читают, а не проглядывают.
  const hasHood = spec.measurements.points.some((p) => p.code === 'H01');

  return (
    `<div class="canvas">` +
    `<div class="ml">${esc(t.flats_label)}</div>` +
    viewFigure(flats.front, t.view_front) +
    viewFigure(flats.back, t.view_back) +
    (flats.side ? viewFigure(flats.side, t.view_side) : '') +
    `</div>` +
    // Длинные пояснения написаны для бренда и по-русски. В нерусском
    // комплекте их нет: русский абзац в китайском техпаке не поясняет,
    // а заставляет писать письмо.
    (locale !== 'ru'
      ? ''
      : `<div class="note" style="margin-top:3mm">Чертёж построен из таблицы замеров: правка ` +
        `значения перестраивает геометрию. Число пунктирных линий равно числу параллельных ` +
        `строчек — по нему определяется тип машины.` +
        sleeveNote(flats) +
        (flats.side
          ? ` <b>Перед и спинка — изделие разложенное, бок — изделие с объёмом.</b> ` +
            `Иначе не бывает: у разложенного изделия глубины нет, она в замерах отсутствует ` +
            `и выведена из обхвата груди по сетке и прибавки на свободу. Поэтому ширину ` +
            `бока не сравнивают с шириной переда — это разные величины на разных видах, ` +
            `и ни одна из них не заменяет табель мер.` +
            (hasHood
              ? ` Капюшон на переде показан разложенным вверх — отраслевая условность; ` +
                `его профиль виден только сбоку.`
              : '')
          : '') +
        `</div>`)
  );
}

/**
 * Раздел чертежа, собранный из библиотечного силуэта.
 *
 * Отдельная функция, а не флаг внутри общей: у этих двух листов разные
 * обещания читателю. Параметрический чертёж говорит «правка замера
 * перестраивает геометрию»; библиотечный обещать этого не может и обязан
 * сказать обратное — размеры живут в табеле, а рисунок показывает силуэт.
 */
function libraryFlatsBody(library: LibraryFlatViews, t: Messages, locale: Locale): string {
  const zoneLabel = { ru: ZONE_LABEL_RU, en: ZONE_LABEL_EN, zh: ZONE_LABEL_ZH }[locale];
  const missing = (library.missing ?? []).map((z) => zoneLabel[z]);
  return (
    `<div class="canvas">` +
    `<div class="ml">${esc(t.flats_label)}</div>` +
    viewFigure({ ...library.front, geometry: {} }, t.view_front) +
    (library.back ? viewFigure({ ...library.back, geometry: {} }, t.view_back) : '') +
    `</div>` +
    `<div class="note" style="margin-top:3mm">${esc(t.flats_library_note)}</div>` +
    // Список того, чего на рисунке нет, — отдельной строкой и заметно:
    // это единственное место, где лист признаёт свою неполноту.
    (missing.length
      ? `<div class="note" style="margin-top:1.5mm"><b>${esc(t.flats_library_missing)}: ` +
        `${esc(missing.join(', '))}.</b></div>`
      : '') +
    // Идентификатор шаблона — не украшение: по нему бренд получает исходник
    // силуэта в выгрузке, а мы понимаем, какой шаблон выбирают чаще прочих.
    `<div class="note" style="margin-top:1mm;opacity:.65">` +
    `${esc(t.flats_library_source)}: ${esc(library.templateId)}</div>`
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
/** Заголовок блока примечаний. Примечания приходят из движка по-русски. */
const NOTES_TITLE = 'Примечания к значениям';

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

function measurementsPages(spec: StyleSpec, pro: boolean, t: Messages, locale: Locale): string[] {
  const graded = spec.base.size_range.filter((ru) => ru !== spec.base.base_size_ru);
  const points = spec.measurements.points.filter((p) => pro || !p.pro_only);

  // Примечания нумеруются ОДИН раз на весь табель и печатаются сносками
  // под таблицей. В ячейке остаётся только номер: калибровка добавляет
  // одну и ту же строку ко всем точкам, и восемнадцать одинаковых
  // примечаний в колонке топят в шуме те, ради которых блок существует.
  // Примечания к значениям приходят из движка по-русски: это объяснения
  // происхождения величин, написанные для бренда. В нерусском комплекте
  // их нет — вместе с номерами сносок, иначе в таблице остались бы
  // указатели в никуда.
  const footnotes = locale === 'ru' ? groupNotes(points) : [];
  const noteNumber = new Map<string, number>();
  footnotes.forEach((n, i) => noteNumber.set(n.text, i + 1));

  const head =
    `<tr><th>${esc(t.pom_code)}</th><th>${esc(t.pom_point)}</th><th>${esc(t.pom_how)}</th>` +
    `<th class="num">RU ${spec.base.base_size_ru}</th><th class="num">${esc(t.pom_tolerance)}</th>` +
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
          `<td class="mono">${p.code}</td><td>${esc(pointName(p, t))}</td>` +
          `<td class="note">${esc(pointHow(p, t))}</td>` +
          `<td class="num v nowrap">${num(p.base.value)}` +
          (ref ? `<sup class="fn-ref">${ref}</sup>` : '') +
          `</td>` +
          `<td class="num v">±${num(p.tolerance.value)}</td>` +
          `<td class="mark"><span class="dot dot-${p.base.confidence}" ` +
          `title="${esc(statusLabel(t, p.base.confidence))}"></span></td>` +
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
      (isLast && locale === 'ru' ? acceptanceNote(pro) : '')
    );
  });

  // Сноски идут отдельным листом только если их слишком много для подвала.
  // Всё, что помещается, печатается прямо под таблицей — там его и ищут.
  const notePages = chunk(footnotes, ROWS_PER_PAGE.notes).map(
    (group, i) =>
      (i === 0 ? `<h2>${esc(NOTES_TITLE)}</h2>` : '') +
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

function bomPages(spec: StyleSpec, t: Messages, locale: Locale): string[] {
  const bom = spec.bom;
  if (!bom) return [];

  const colorways = bom.colorways
    .map(
      (c) =>
        `<span style="margin-right:6mm">` +
        (c.hex_approx
          ? `<span class="swatch" style="background:${esc(c.hex_approx)}"></span>`
          : '') +
        `${esc(locale === 'ru' ? c.name_ru : c.id)}</span>`,
    )
    .join('');

  const head =
    `<tr><th>${esc(t.bom_code)}</th><th>${esc(t.bom_item)}</th>` +
    `<th>${esc(t.bom_purpose)}</th><th>${esc(t.bom_composition)}</th>` +
    `<th class="num">${esc(t.bom_gsm)}</th><th class="num">${esc(t.bom_consumption)}</th>` +
    `<th>${esc(t.bom_supplier)}</th></tr>`;

  return chunk(bom.lines, ROWS_PER_PAGE.bom).map((lines, i, all) => {
    const rows = lines
      .map(
        (l) =>
          `<tr><td class="mono">${l.code}</td><td>${esc(materialName(l, locale))}</td>` +
          // Назначение в нерусском комплекте берётся из РОЛИ материала,
          // а не из вольного текста: роль — замкнутое перечисление, её перевод
          // полон по устройству, а вольную строку пришлось бы переводить
          // на каждый новый материал и однажды забыть.
          `<td class="note">${esc(
            locale === 'ru'
              ? l.placement_ru
              : locale === 'zh'
                ? MATERIAL_ROLE_LABEL_ZH[l.role]
                : MATERIAL_ROLE_LABEL_EN[l.role],
          )}</td>` +
          `<td>${locale === 'ru' ? value(l.composition) : esc(composition(l, locale))}</td>` +
          `<td class="num">${l.gsm ? value(l.gsm) : '—'}</td>` +
          `<td class="num v">${l.consumption ? `${num(l.consumption.value)} ${l.consumption_unit}` : '—'}</td>` +
          `<td class="note">${l.supplier_article ?? esc(t.bom_supplier_tbd)}</td></tr>`,
      )
      .join('');

    const isLast = i === all.length - 1;
    return (
      (i === 0
        ? `<div class="note" style="margin-bottom:3mm"><b>${esc(t.bom_colorways)}:</b> ${colorways}</div>`
        : '') +
      `<table><thead>${head}</thead><tbody>${rows}</tbody></table>` +
      (isLast && locale === 'ru'
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

function constructionPages(spec: StyleSpec, pro: boolean, t: Messages, locale: Locale): string[] {
  const c = spec.construction;
  if (!c) return [];

  const MACHINE = { ru: MACHINE_LABEL_RU, en: MACHINE_LABEL_EN, zh: MACHINE_LABEL_ZH }[locale];
  const ZONE = { ru: ZONE_LABEL_RU, en: ZONE_LABEL_EN, zh: ZONE_LABEL_ZH }[locale];
  const machine = (m: string): string => MACHINE[m as MachineType] ?? m;
  const label = (n: NonNullable<StyleSpec['construction']>['nodes'][number]): string =>
    locale === 'ru'
      ? n.label_ru
      : locale === 'zh'
        ? (n.label_zh ?? n.label_en ?? n.label_ru)
        : (n.label_en ?? n.label_ru);
  const plain = (n: NonNullable<StyleSpec['construction']>['nodes'][number]): string =>
    locale === 'ru'
      ? n.plain_ru
      : locale === 'zh'
        ? (n.plain_zh ?? n.plain_en ?? n.plain_ru)
        : (n.plain_en ?? n.plain_ru);

  const nodeHead =
    `<tr><th>№</th><th>${esc(t.node_zone)}</th><th>${esc(t.node_name)}</th>` +
    (pro
      ? `<th>${esc(t.node_seam)} / ${esc(t.node_stitch)}</th>` +
        `<th class="num">${esc(t.node_spi)}</th><th>${esc(t.node_machine)}</th>`
      : '') +
    `<th class="num">${esc(t.node_allowance)}</th><th class="mark">●</th></tr>`;

  const nodePages = chunk(c.nodes, ROWS_PER_PAGE.nodes).map((nodes, page) => {
    const rows = nodes
      .map((n, i) => {
        const number = page * ROWS_PER_PAGE.nodes + i + 1;
        return (
          `<tr><td class="num mono">${number}</td>` +
          `<td class="note">${ZONE[n.zone as NodeZone] ?? esc(n.zone)}</td>` +
          `<td><b>${esc(label(n))}</b>` +
          (n.requires_special_equipment
            ? ` <span class="flag">${locale === 'ru' ? 'спецоборудование' : locale === 'zh' ? '专机' : 'special machine'}</span>`
            : '') +
          `<div class="note">${esc(plain(n))}</div>` +
          // Замена под базовый парк — русский текст из справочника замен.
          // В нерусском комплекте печатается только имя альтернативного узла
          // и машина: они переведены, а пояснение нет.
          (n.alternative
            ? `<div class="note warn">${
                locale === 'ru' ? 'Замена под базовый парк цеха: ' : ''
              }${esc(locale === 'ru' ? n.alternative.label_ru : n.alternative.node_id)} ` +
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
          `title="${esc(statusLabel(t, n.presence.confidence))}"></span></td></tr>`
        );
      })
      .join('');

    return `<h2>${esc(t.section_construction)}</h2><table><thead>${nodeHead}</thead><tbody>${rows}</tbody></table>`;
  });

  // Перевод операции едет со снапшотом. Если его там нет (документ собран
  // до 0.9.0), лист опускается целиком: наполовину русская последовательность
  // читается фабрикой хуже, чем её отсутствие.
  const translated =
    locale === 'ru' || c.sequence.every((s) => (locale === 'en' ? s.operation_en : s.operation_zh));
  if (!translated) return nodePages;

  const operation = (s: (typeof c.sequence)[number]): string =>
    locale === 'en'
      ? (s.operation_en ?? s.operation_ru)
      : locale === 'zh'
        ? (s.operation_zh ?? s.operation_ru)
        : s.operation_ru;

  const seqPages = chunk(c.sequence, ROWS_PER_PAGE.sequence).map((steps, i, all) => {
    const rows = steps
      .map(
        (s) =>
          `<tr><td class="num mono">${s.step}</td><td>${esc(operation(s))}</td>` +
          `<td class="mono" title="${SPECIALTY_LABEL_RU[s.specialty as Specialty] ?? ''}">${s.specialty}</td>` +
          `<td class="note">${esc(machine(s.machine))}</td>` +
          `<td class="num v">${s.time_sec ?? '—'}</td></tr>`,
      )
      .join('');

    return (
      `<h2>${esc(t.seq_title)}</h2>` +
      `<table><thead><tr><th>${esc(t.seq_no)}</th><th>${esc(t.seq_operation)}</th>` +
      `<th>${esc(t.seq_specialty)}</th><th>${esc(t.seq_machine)}</th>` +
      `<th class="num">${esc(t.seq_time)}</th></tr></thead><tbody>${rows}</tbody></table>` +
      (i === all.length - 1
        ? `<div class="note" style="margin-top:3mm">` +
          (locale === 'ru'
            ? `Специальности: ` +
              (Object.entries(SPECIALTY_LABEL_RU) as [Specialty, string][])
                .map(([k, v]) => `${k} — ${v}`)
                .join(', ') +
              `. `
            : '') +
          `${esc(t.seq_time_note)}</div>`
        : '')
    );
  });

  return [...nodePages, ...seqPages];
}

// ---------------------------------------------------------------- маркировка

function labelsPages(spec: StyleSpec, t: Messages, locale: Locale): string[] {
  const l = spec.labels;
  if (!l) return [];
  const ru = locale === 'ru';
  // Названия реквизитов — наш текст, и без перевода лист бесполезен фабрике.
  // Значения внутри останутся русскими: это надписи на ярлыке, их печатают
  // буквально по ТР ТС 017/2011, а не читают.
  const translated = ru || l.requisites.every((r) => (locale === 'en' ? r.label_en : r.label_zh));
  if (!translated) return [];
  // Подпись на языке комплекта, если перевод доехал со снапшотом. Нет —
  // печатаем русскую: пустая ячейка в реквизитах хуже непереведённой.
  const tr = (x: {
    label_ru: string;
    label_en?: string | undefined;
    label_zh?: string | undefined;
  }): string =>
    locale === 'en'
      ? (x.label_en ?? x.label_ru)
      : locale === 'zh'
        ? (x.label_zh ?? x.label_ru)
        : x.label_ru;

  const requisites = l.requisites
    .map(
      (r) =>
        `<tr><td>${esc(tr(r))}${r.required ? ' <span class="v">*</span>' : ''}</td>` +
        // Значение — это ТЕКСТ НА ЯРЛЫКЕ. Он русский по ТР ТС 017/2011 даже
        // в китайском комплекте: фабрика печатает его буквально, а не читает.
        `<td data-ru-content>${
          r.value
            ? value(r.value)
            : `<span class="flag">${esc(t.not_filled)}</span>` +
              (ru ? ` <span class="note">${esc(r.action_ru ?? '')}</span>` : '')
        }</td></tr>`,
    )
    .join('');

  // Символы ухода без перевода в нерусском комплекте не печатаем: это наши
  // подписи, а не содержимое ярлыка, и половина строки по-русски бесполезна.
  const careTranslated =
    ru || l.care_symbols.every((s) => (locale === 'en' ? s.label_en : s.label_zh));
  const care = careTranslated ? l.care_symbols.map((s) => esc(tr(s))).join(' · ') : '';

  const first =
    `<div class="grid2">` +
    `<div><h2>${esc(t.labels_requisites)}</h2>` +
    `<table><tbody>${requisites}</tbody></table>` +
    `<div class="note" style="margin-top:2mm">` +
    (ru
      ? `* обязательно по статье 9 ТР ТС 017/2011. ` +
        `Все надписи — на русском языке, на изделии, этикетке, ярлыке или упаковке.`
      : esc(t.labels_ru_only)) +
    `</div></div>` +
    `<div><h2>${esc(t.labels_care)}</h2>` +
    (care
      ? `<div class="card"><div class="note">${care}</div></div>`
      : `<div class="card"><div class="note">${esc(t.labels_care_ru_only)}</div></div>`) +
    (ru
      ? `<div class="note" style="margin-top:2mm">Порядок символов по ГОСТ ISO 3758: стирка, ` +
        `отбеливание, сушка, глажение, профессиональная чистка. Режим ухода зависит от ` +
        `конкретного полотна — подтвердите у поставщика.</div>`
      : '') +
    `</div>` +
    `</div>`;

  const skuPages = chunk(l.sku_matrix, ROWS_PER_PAGE.sku).map((rows, i, all) => {
    const body = rows
      .map(
        (s) =>
          `<tr><td class="mono">${esc(s.sku)}</td><td data-ru-content>${esc(s.colorway_ru)}</td>` +
          `<td class="num">${s.size_ru}</td><td class="note">${esc(t.labels_gtin_tbd)}</td></tr>`,
      )
      .join('');
    return (
      `<h2>${esc(t.labels_sku_matrix)}</h2>` +
      `<table><thead><tr><th>${esc(t.labels_col_sku)}</th><th>${esc(t.labels_col_color)}</th>` +
      `<th class="num">${esc(t.labels_col_size)}</th>` +
      `<th>${esc(t.labels_col_gtin)}</th></tr></thead><tbody>${body}</tbody></table>` +
      (i === all.length - 1 && ru
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
