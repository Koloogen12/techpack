/**
 * Состязательный прогон по флоу. Не «код не упал», а «документом можно
 * пользоваться»: каждая проверка отвечает на вопрос, который задаст фабрика.
 */
import { buildStyleSpec } from '@seamster/assembly';
import { renderHtml, renderRfqHtml, rfqText, RFQ_TEXT_LIMIT } from '@seamster/docgen';
import { checkFlatLines, flatDefaults, renderFlatsFromSpec } from '@seamster/flats';
import { CATEGORIES, kb, ZONE_LABEL_RU, type Category, type NodeZone } from '@seamster/kb';
import { LOCALES } from '@seamster/i18n';
import {
  catalogedEntries,
  landmarksOf,
  proposeTemplates,
  readTemplateSvg,
  renderChosenTemplate,
  templateLibraryExists,
} from '@seamster/templates';

const CYRILLIC = /[А-Яа-яЁё]{3,}/;

/** Текст, который человек видит: без стилей, скриптов и разметки. */
const visible = (html: string): string =>
  html
    // Содержимое ярлыка печатается по-русски по ТР ТС 017/2011 — это не
    // утечка, а требование закона, и документ об этом говорит прямо.
    .replace(/<td data-ru-content>[\s\S]*?<\/td>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
const problems: string[] = [];
const note = (area: string, text: string): void => {
  problems.push(`${area}: ${text}`);
};

const specFor = (category: Category) =>
  buildStyleSpec({
    id: `qa-${category}`,
    name: `QA ${category}`,
    article: `QA-${category.toUpperCase()}`,
    category,
    gender: 'women',
    base_size_ru: 46,
    base_height_cm: 170,
    fit_intent: 'semi_fitted',
    fabric_kind: 'knit',
    size_range: [42, 44, 46, 48, 50],
    machine_park: 'base_shop',
    generated_at: new Date('2026-08-27T00:00:00.000Z'),
  }).spec;

// --- 1. документ на всех категориях и языках
for (const category of CATEGORIES) {
  let spec;
  try {
    spec = specFor(category);
  } catch (e) {
    note('сборка спеки', `${category}: ${String(e).slice(0, 120)}`);
    continue;
  }
  for (const locale of LOCALES) {
    let html = '';
    try {
      html = renderHtml(spec, { pro: true, locale });
    } catch (e) {
      note('документ', `${category}/${locale}: ${String(e).slice(0, 120)}`);
      continue;
    }
    if (locale === 'ru') continue;
    // Данные бренда остаются как есть; ищем НАШИ слова. Содержимое <style>
    // и <script> читателю не видно — комментарий в CSS не утечка.
    const text = visible(html)
      .replace(new RegExp(spec.style.name, 'g'), '')
      .replace(/QA-[A-Z_]+/g, '');
    const leaks = [...new Set(text.match(/[А-Яа-яЁё]{4,}/g) ?? [])];
    // Названия материалов и уход на ярлыке остаются русскими по закону —
    // они уже вырезаны выше вместе с блоком ярлыка.
    const label = new Set(['Пример', 'Основной']);
    const real = leaks.filter((w) => !label.has(w));
    if (real.length > 3)
      note('язык документа', `${category}/${locale}: ${real.slice(0, 6).join(', ')}`);
  }
}

// --- 2. лист на просчёт на всех категориях и языках
for (const category of CATEGORIES) {
  const spec = specFor(category);
  for (const locale of LOCALES) {
    try {
      const html = renderRfqHtml(spec, { locale });
      const text = rfqText(spec, { locale });
      if (text.length > RFQ_TEXT_LIMIT) {
        note('лист на просчёт', `${category}/${locale}: текст ${text.length} знаков`);
      }
      if (locale !== 'ru') {
        const stripped = visible(html).replace(new RegExp(spec.style.name, 'g'), '');
        if (CYRILLIC.test(stripped.replace(/QA[^\s]*/g, ''))) {
          const found = stripped.match(/[А-Яа-яЁё]{4,}/g) ?? [];
          note(
            'язык листа',
            `${category}/${locale}: ${[...new Set(found)].slice(0, 5).join(', ')}`,
          );
        }
      }
    } catch (e) {
      note('лист на просчёт', `${category}/${locale}: ${String(e).slice(0, 120)}`);
    }
  }
}

// --- 3. чертёж: связь узла и линии на всех категориях
for (const category of CATEGORIES) {
  const spec = specFor(category);
  const flats = renderFlatsFromSpec(spec, flatDefaults(spec));
  const svgs = [flats.front.svg, flats.back.svg, ...(flats.side ? [flats.side.svg] : [])];
  const report = checkFlatLines(spec, svgs);
  if (!report.ok) {
    note(
      'чертёж',
      `${category}: нет линий ${report.missing.map((m) => m.expected).join(', ')} · лишние ${report.orphan.join(', ')}`,
    );
  }
}

// --- 4. библиотека: каждый силуэт обязан отрисоваться или честно отказать
if (templateLibraryExists()) {
  const base = kb();
  const spec = specFor('hoodie');
  const zones = [
    ...new Set(
      (spec.construction?.nodes ?? [])
        .filter((n) => base.node(n.node_id).flat_line !== null)
        .map((n) => n.zone as NodeZone)
        .filter((z) => z !== 'labels'),
    ),
  ];
  const master = renderFlatsFromSpec(spec, flatDefaults(spec));
  let rendered = 0;
  let refused = 0;
  for (const e of catalogedEntries()) {
    if (!e.svg_back) continue;
    try {
      const svg = readTemplateSvg(e, 'front');
      if (!svg) {
        note('библиотека', `${e.id}: файл переднего вида не читается`);
        continue;
      }
      if (!landmarksOf(svg)) note('библиотека', `${e.id}: ориентиры не считались`);
      const r = renderChosenTemplate(e.id, {
        targetWidthCm: master.front.viewBox.width,
        targetHeightCm: master.front.viewBox.height,
        bodyWidthCm: 51,
        bodyRatio: 0.7,
        disclaimer: 'п',
        zones,
        zoneLabel: (z) => ZONE_LABEL_RU[z],
      });
      if (r) rendered++;
      else refused++;
    } catch (e2) {
      note('библиотека', `${e.id}: падение — ${String(e2).slice(0, 100)}`);
    }
  }
  console.log(`библиотека: отрисовано ${rendered}, отклонено по пропорциям ${refused}`);

  // подбор обязан что-то предложить в каждой нашей категории
  for (const category of CATEGORIES) {
    const s = specFor(category);
    const m = renderFlatsFromSpec(s, flatDefaults(s));
    const choice = proposeTemplates(s, {
      aspect: m.front.viewBox.width / m.front.viewBox.height,
    });
    if (choice.candidates.length === 0)
      note('подбор', `${category}: библиотека не предложила ничего`);
  }
} else {
  note('библиотека', 'манифест не найден');
}

// --- 5. перебор посадок и границ размерного ряда
const FITS = ['fitted', 'semi_fitted', 'loose', 'oversize'] as const;
for (const category of CATEGORIES) {
  for (const fit of FITS) {
    for (const [ru, height] of [
      [42, 152],
      [52, 182],
    ] as const) {
      try {
        const spec = buildStyleSpec({
          id: 'qa',
          name: 'QA',
          article: 'QA-X',
          category,
          gender: 'women',
          base_size_ru: ru,
          base_height_cm: height,
          fit_intent: fit,
          fabric_kind: 'knit',
          size_range: [ru],
          machine_park: 'base_shop',
          generated_at: new Date('2026-08-27T00:00:00.000Z'),
        }).spec;
        // Замеры обязаны быть конечными и положительными на любой границе.
        for (const p of spec.measurements.points) {
          if (!Number.isFinite(p.base.value) || p.base.value <= 0) {
            note('границы', `${category}/${fit}/RU${ru}: ${p.code} = ${p.base.value}`);
          }
          if (p.tolerance.value <= 0) {
            note('границы', `${category}/${fit}/RU${ru}: допуск ${p.code} = ${p.tolerance.value}`);
          }
        }
        renderFlatsFromSpec(spec, flatDefaults(spec));
      } catch (e) {
        note('границы', `${category}/${fit}/RU${ru}: ${String(e).slice(0, 100)}`);
      }
    }
  }
}

// --- 6. кривой вход обязан падать понятной ошибкой, а не стеком
const BAD: [string, Record<string, unknown>][] = [
  ['размер вне сетки', { base_size_ru: 999 }],
  ['рост вне диапазона', { base_height_cm: 300 }],
  ['базовый размер не в ряду', { size_range: [44, 48] }],
];
for (const [label, patch] of BAD) {
  try {
    buildStyleSpec({
      id: 'qa',
      name: 'QA',
      article: 'QA-X',
      category: 'tshirt',
      gender: 'women',
      base_size_ru: 46,
      base_height_cm: 170,
      fit_intent: 'semi_fitted',
      fabric_kind: 'knit',
      size_range: [46],
      machine_park: 'base_shop',
      generated_at: new Date('2026-08-27T00:00:00.000Z'),
      ...patch,
    } as Parameters<typeof buildStyleSpec>[0]);
    note('кривой вход', `${label}: принято молча`);
  } catch (e) {
    const err = e as { userMessage?: string; userAction?: string };
    if (!err.userMessage || !err.userAction) {
      note('кривой вход', `${label}: ошибка без объяснения человеку`);
    }
  }
}

console.log(`\nнайдено проблем: ${problems.length}`);
for (const p of problems) console.log(`  · ${p}`);
