import {
  CATEGORY_LABEL_EN,
  CATEGORY_LABEL_RU,
  CATEGORY_LABEL_ZH,
  kb as defaultKb,
  type Category,
  type KnowledgeBase,
} from '@seamsterly/kb';
import { messages, type Locale } from '@seamsterly/i18n';

/**
 * Печатный бланк замеров.
 *
 * Половина протокола, которая попадает в руки человеку. Тот, кто мерит вещь
 * рулеткой, не откроет JSON и не станет сверяться со справочником с экрана —
 * ему нужен лист бумаги рядом с изделием.
 *
 * Порядок точек на бланке — порядок ИЗМЕРЕНИЯ, а не порядок кодов: сверху вниз
 * по изделию, потом рукав, потом отделочные детали. Так вещь берут в руки
 * один раз, а не перекладывают под каждую точку.
 */

/**
 * Порядок обхода изделия рулеткой.
 * Точки, которых нет в списке, идут в конце по коду.
 */
const MEASURING_ORDER = [
  // Сначала габарит: он задаёт, как разложить вещь.
  'T01',
  'T02',
  // Верх, сверху вниз.
  'T14',
  'T15',
  'T16',
  'T17',
  'T06',
  'T18',
  'T09',
  // Корпус.
  'T03',
  'T07',
  'T08',
  'T04',
  'T05',
  // Рукав целиком, не отпуская.
  'T10',
  'T11',
  'T12',
  'T13',
  // Отделочные детали и капюшон.
  'H07',
  'H08',
  'H01',
  'H02',
  'H03',
  'H04',
  'H05',
  'H06',
];

export interface FormOptions {
  /**
   * Язык бланка. Мерит тот, у кого изделие в руках, и это бывает
   * иностранная фабрика: правила измерения на незнакомом языке
   * означают, что мерить будут как привыкли, а не как здесь написано.
   */
  locale?: Locale;
  category: Category;
  /** Что за вещь. Печатается в шапке, чтобы бланки не перепутались. */
  title?: string;
  /** Только обязательные точки. Быстрый бланк для первого прохода. */
  requiredOnly?: boolean;
}

export function renderMeasurementForm(
  options: FormOptions,
  base: KnowledgeBase = defaultKb(),
): string {
  const template = base.pomTemplate(options.category);
  const points = template.points
    .filter((p) => !options.requiredOnly || p.required)
    .slice()
    .sort((a, b) => rank(a.code) - rank(b.code));

  const t = messages(options.locale ?? 'ru');
  const name = (p: (typeof points)[number]): string =>
    options.locale === 'zh' ? p.name_zh : options.locale === 'en' ? p.name_en : p.name_ru;
  const how = (p: (typeof points)[number]): string =>
    options.locale === 'zh'
      ? p.how_to_measure_zh
      : options.locale === 'en'
        ? p.how_to_measure_en
        : p.how_to_measure_ru;

  const rows = points
    .map(
      (p) =>
        `<tr>` +
        `<td class="code">${p.code}</td>` +
        `<td><b>${esc(name(p))}</b><div class="how">${esc(how(p))}</div></td>` +
        `<td class="box"></td>` +
        `<td class="box"></td>` +
        `<td class="note-cell"></td>` +
        `</tr>`,
    )
    .join('');

  const category = {
    ru: CATEGORY_LABEL_RU,
    en: CATEGORY_LABEL_EN,
    zh: CATEGORY_LABEL_ZH,
  }[options.locale ?? 'ru'];
  const title = options.title ?? capitalize(category[options.category]);

  return `<!doctype html><html lang="${options.locale ?? 'ru'}"><head><meta charset="utf-8">
<title>${esc(t.form_kicker)} — ${esc(title)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Sora, "Helvetica Neue", Arial, sans-serif; color: #0E0E0E; font-size: 9pt; }
  .kicker { font-size: 7.4pt; letter-spacing: 1.4px; text-transform: uppercase; font-weight: 700; color: #6B6B67; }
  h1 { font-size: 15pt; font-weight: 700; margin: 1mm 0 3mm; }
  .head { border-bottom: 1px solid #E4E1DC; padding-bottom: 3mm; margin-bottom: 4mm; }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-bottom: 4mm; }
  .meta .field { border-bottom: 1px solid #0E0E0E; padding-bottom: 4mm; }
  .meta .label { font-size: 7pt; letter-spacing: 0.9px; text-transform: uppercase; color: #6B6B67; }
  .rules { background: rgba(14,14,14,.03); border-radius: 2mm; padding: 3mm 4mm; margin-bottom: 4mm; font-size: 8pt; line-height: 1.5; }
  .rules b { font-weight: 700; }
  .rules ol { margin: 1.5mm 0 0; padding-left: 4mm; }
  .rules li { margin-bottom: 0.8mm; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 7pt; letter-spacing: 0.9px; text-transform: uppercase; color: #6B6B67;
       font-weight: 700; padding: 1.5mm 2mm; border-bottom: 1px solid #E4E1DC; }
  td { padding: 1.8mm 2mm; border-bottom: 1px solid #EFEDE9; vertical-align: top; }
  td.code { font-family: "JetBrains Mono", monospace; font-size: 8pt; width: 12mm; }
  .how { font-size: 7.4pt; color: #5A5A56; line-height: 1.35; margin-top: 0.6mm; }
  td.box { width: 20mm; border-bottom: 1px solid #0E0E0E; }
  td.note-cell { width: 34mm; border-bottom: 1px solid #EFEDE9; }
  tr { break-inside: avoid; }
  .foot { margin-top: 4mm; font-size: 7.4pt; color: #5A5A56; line-height: 1.45; }
</style></head><body>
<div class="head">
  <div class="kicker">${esc(t.form_kicker)}</div>
  <h1>${esc(title)}</h1>
</div>

<div class="meta">
  <div class="field"><div class="label">${esc(t.form_who)}</div></div>
  <div class="field"><div class="label">${esc(t.form_date)}</div></div>
  <div class="field"><div class="label">${esc(t.form_label_size)}</div></div>
  <div class="field"><div class="label">${esc(t.form_tool)}</div></div>
</div>

<div class="rules">
  <b>${esc(t.form_rules_title)}</b>
  <ol>${t.form_rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
</div>

<table>
  <thead><tr><th>${esc(t.pom_code)}</th><th>${esc(t.form_th_point)}</th><th>${esc(t.form_th_value)}</th><th>${esc(t.form_th_repeat)}</th><th>${esc(t.form_th_note)}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class="foot">${t.form_foot}</div>
</body></html>`;
}

function rank(code: string): number {
  const i = MEASURING_ORDER.indexOf(code);
  return i === -1 ? MEASURING_ORDER.length + code.charCodeAt(0) : i;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`,
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
