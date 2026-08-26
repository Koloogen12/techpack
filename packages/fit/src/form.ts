import {
  CATEGORY_LABEL_RU,
  kb as defaultKb,
  type Category,
  type KnowledgeBase,
} from '@seamsterly/kb';

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

  const rows = points
    .map(
      (p) =>
        `<tr>` +
        `<td class="code">${p.code}</td>` +
        `<td><b>${esc(p.name_ru)}</b><div class="how">${esc(p.how_to_measure_ru)}</div></td>` +
        `<td class="box"></td>` +
        `<td class="box"></td>` +
        `<td class="note-cell"></td>` +
        `</tr>`,
    )
    .join('');

  const title = options.title ?? capitalize(CATEGORY_LABEL_RU[options.category]);

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Бланк замеров — ${esc(title)}</title>
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
  <div class="kicker">Бланк замеров · Seamsterly</div>
  <h1>${esc(title)}</h1>
</div>

<div class="meta">
  <div class="field"><div class="label">Кто мерил</div></div>
  <div class="field"><div class="label">Дата</div></div>
  <div class="field"><div class="label">Размер на ярлыке</div></div>
  <div class="field"><div class="label">Чем мерили</div></div>
</div>

<div class="rules">
  <b>Как мерить, чтобы замеры можно было сравнивать</b>
  <ol>
    <li>Разложите вещь на ровной твёрдой поверхности лицом вверх, разгладьте руками. Не растягивайте и не натягивайте полотно — рибана и трикотаж тянутся, и натянутый замер завышен на сантиметр и больше.</li>
    <li>Мерьте по разложенному изделию, а не на человеке и не на манекене. Замер на фигуре систематически больше, и смешивать их в одной выборке нельзя.</li>
    <li>Ленту кладите плашмя, без провисания и без нажима. Читайте с точностью до половины сантиметра.</li>
    <li>Ширины по груди, талии и низу — от шва до шва в плоском виде, то есть половина обхвата. Не удваивайте.</li>
    <li>Сомневаетесь в точке — померьте второй раз и запишите оба значения. Расхождение больше двух сантиметров означает, что мерили по-разному.</li>
    <li>Сфотографируйте ту же вещь на том же столе сверху: замеры без снимка того же изделия не калибруют ничего.</li>
  </ol>
</div>

<table>
  <thead><tr><th>Код</th><th>Точка измерения и как её мерить</th><th>Замер, см</th><th>Повтор, см</th><th>Примечание</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class="foot">
  Заполненный бланк переносится в файл <code>golden/measured/&lt;имя&gt;.json</code> — формат
  и порядок работы описаны в <code>docs/RULER-PROTOCOL.md</code>. Сравнение с документом
  запускается командой <code>pnpm fit:score</code>.
</div>
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
