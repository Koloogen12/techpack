/**
 * Второй круг: не «работает ли», а «не врёт ли одно другому».
 * Самые дорогие дефекты — это когда два документа об одном изделии
 * расходятся, и фабрика узнаёт об этом после раскроя.
 */
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { renderHtml, renderRfqHtml, rfqText } from '@seamster/docgen';
import { flatDefaults, measurementsFrom, renderFlatsFromSpec } from '@seamster/flats';
import { CATEGORIES, kb, type Category } from '@seamster/kb';
import { LOCALES } from '@seamster/i18n';
import { specFingerprint } from '@seamster/stylespec';

const problems: string[] = [];
const note = (a: string, t: string): void => void problems.push(`${a}: ${t}`);

const input = (category: Category, over: Partial<StyleSpecInput> = {}): StyleSpecInput => ({
  id: 'r2',
  name: 'R2',
  article: 'R2-001',
  category,
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  machine_park: 'base_shop',
  quantity: 100,
  generated_at: new Date('2026-08-27T00:00:00.000Z'),
  ...over,
});

for (const category of CATEGORIES) {
  const { spec } = buildStyleSpec(input(category));

  // 1. Повторный прогон того же входа даёт тот же отпечаток.
  const again = buildStyleSpec(input(category)).spec;
  if (specFingerprint(spec) !== specFingerprint(again)) {
    note('повторяемость', `${category}: два прогона одного входа разошлись`);
  }

  // 2. Табель и чертёж говорят одно: ширина груди на чертеже равна замеру.
  const m = measurementsFrom(spec);
  const t03 = spec.measurements.points.find((p) => p.code === 'T03')?.base.value;
  if (t03 !== undefined && Math.abs(m.chestFlat - t03) > 0.01) {
    note('чертёж↔табель', `${category}: грудь ${t03} в табеле, ${m.chestFlat} на чертеже`);
  }

  // 3. Лист на просчёт и пак называют одно и то же полотно и тираж.
  const rfq = renderRfqHtml(spec);
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  if (shell && !rfq.includes(shell.name_ru)) {
    note('лист↔пак', `${category}: полотно «${shell.name_ru}» не попало на лист`);
  }
  if (spec.bom?.batch_qty && !rfq.includes(String(spec.bom.batch_qty))) {
    note('лист↔пак', `${category}: тираж не попал на лист`);
  }

  // 4. Градация монотонна: соседний размер не может быть меньше.
  for (const p of spec.measurements.points) {
    const values = p.graded.map((g) => g.value.value);
    for (let i = 1; i < values.length; i++) {
      if (values[i]! < values[i - 1]! - 0.001) {
        note('градация', `${category}/${p.code}: ${values[i - 1]} → ${values[i]}`);
        break;
      }
    }
  }

  // 5. Перехлёст размеров — свойство размерной системы, а не дефект: шаг
  //    градации мелких точек в десятых долях, а рулетка читается с
  //    точностью до половины сантиметра, и допуск ниже погрешности
  //    измерения бессмыслен. Обязательно не отсутствие перехлёста, а
  //    РАЗГОВОР о нём: молчащий документ отдаёт ОТК изделие, законно
  //    проходящее приёмку сразу в двух размерах.
  const overlapping = spec.measurements.points.filter((p) => {
    if (p.graded.length < 2) return false;
    const step = Math.abs(p.graded[1]!.value.value - p.graded[0]!.value.value);
    return step > 0 && p.tolerance.value > step / 2 + 0.001;
  });
  if (overlapping.length > 0) {
    const { notes } = buildStyleSpec(input(category));
    if (!notes.some((n) => /различ|двух размерах/i.test(n))) {
      note(
        'перехлёст',
        `${category}: ${overlapping.length} точек перехлёстываются, документ молчит`,
      );
    }
  }

  // 6. Ни одного значения без источника.
  for (const p of spec.measurements.points) {
    if (!p.base.confidence) note('честность', `${category}/${p.code}: замер без источника`);
  }

  // 7. Каждый язык даёт непустой документ сопоставимого объёма.
  const sizes = LOCALES.map((l) => renderHtml(spec, { pro: true, locale: l }).length);
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  if (min < max * 0.5) {
    note('языки', `${category}: объём документа ${sizes.join(' / ')} — комплект неполон`);
  }
}

// 8. Тираж и раскладка: сумма долей не обязана равняться тиражу, но
//    выдумывать раскладку мы не имеем права.
const { spec } = buildStyleSpec(input('hoodie'));
if (!rfqTextHasRatioWarning(spec)) {
  note('раскладка', 'без size_ratio лист не предупреждает о её отсутствии');
}
function rfqTextHasRatioWarning(s: typeof spec): boolean {
  return rfqText(s).includes('уточняется');
}

// 9. Чертёж строится на любой посадке и не вырождается.
for (const category of CATEGORIES) {
  for (const fit of ['fitted', 'oversize'] as const) {
    const { spec: s } = buildStyleSpec(input(category, { fit_intent: fit }));
    const flats = renderFlatsFromSpec(s, flatDefaults(s));
    for (const [view, r] of Object.entries(flats)) {
      if (!r) continue;
      const box = (r as { viewBox: { width: number; height: number } }).viewBox;
      if (box.width <= 0 || box.height <= 0) {
        note('чертёж', `${category}/${fit}/${view}: вырожденный габарит`);
      }
      if (!(r as { svg: string }).svg.includes('<path')) {
        note('чертёж', `${category}/${fit}/${view}: пустой SVG`);
      }
    }
  }
}

// 10. Справочник: ни одного узла без кода шва там, где он обязан быть.
const base = kb();
for (const category of CATEGORIES) {
  const { spec: s } = buildStyleSpec(input(category));
  for (const n of s.construction?.nodes ?? []) {
    const entry = base.node(n.node_id);
    if (entry.flat_line !== null && !n.stitch_code) {
      note('конструкция', `${category}/${n.node_id}: узел со швом без кода стежка`);
    }
  }
}

console.log(`\nнайдено проблем: ${problems.length}`);
for (const p of problems) console.log(`  · ${p}`);
