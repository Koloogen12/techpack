/**
 * Демонстрация рулетка-протокола на синтетических замерах.
 *
 * Запуск: pnpm fit:demo
 *
 * Берёт то, что выдаёт пайплайн, и вносит ИЗВЕСТНЫЙ снос: длины завышены
 * на семь процентов, ширины — шум в пределах допуска. Дальше запускается
 * тот же `fit:score`, что и на настоящих замерах.
 *
 * Смысл — показать инструмент до того, как появятся реальные вещи, и заодно
 * проверить, что отчёт действительно находит снос, который туда положили.
 *
 * Файлы пишутся во ВРЕМЕННЫЙ каталог и в репозиторий не попадают: выдуманные
 * замеры в `golden/measured` откалибровали бы справочник по выдумке.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defined } from '@specform/core';
import { buildStyleSpec, photoRatiosFrom } from '@specform/assembly';
import { VisionReportSchema } from '@specform/vision';
import { parseAnswers } from '@specform/cli';

const AT = new Date('2026-08-25T00:00:00.000Z');

/** Точки, на которые кладём систематический снос. */
const BIASED = new Set(['T01', 'T02', 'T10', 'T11']);
const BIAS = 1.07;

const root = mkdtempSync(join(tmpdir(), 'specform-fit-demo-'));
mkdirSync(join(root, 'measured'), { recursive: true });
mkdirSync(join(root, 'vision-reports'), { recursive: true });

const CATEGORIES = ['tshirt', 'longsleeve', 'sweatshirt', 'hoodie'] as const;

for (const category of CATEGORIES) {
  const answers = parseAnswers(
    JSON.parse(readFileSync(`golden/answers/${category}-women-46.json`, 'utf8')),
  );
  const report = VisionReportSchema.parse(
    JSON.parse(readFileSync(`golden/vision-reports/${category}.json`, 'utf8')),
  );
  writeFileSync(join(root, 'vision-reports', `${category}.json`), JSON.stringify(report, null, 2));

  const { spec } = buildStyleSpec({
    ...defined(answers),
    photo_ratios: photoRatiosFrom(report.proportions),
    visible_elements: report.visible_elements,
    topstitching: report.topstitching,
    generated_at: AT,
  });

  // Снос на длинах и разброс на остальном — так выглядит реальность.
  // Разброс обязан различаться МЕЖДУ изделиями: шум, одинаковый на всех
  // вещах, перестаёт быть шумом и порождает ложные подсказки на мелких
  // точках. Первая версия демо именно на этом и попалась.
  const seed = category.length + CATEGORIES.indexOf(category) * 7;
  const values = spec.measurements.points.map((p, i) => ({
    code: p.code,
    value_cm:
      Math.round(
        (BIASED.has(p.code)
          ? p.base.value / BIAS
          : p.base.value + (((i * 13 + seed * 31) % 7) - 3) * 0.15) * 10,
      ) / 10,
  }));

  writeFileSync(
    join(root, 'measured', `${category}.json`),
    JSON.stringify(
      {
        id: `демо-${category}`,
        photo: `golden/photos/${category}-front.png`,
        answers: `golden/answers/${category}-women-46.json`,
        measured_by: 'демонстрация',
        measured_at: '2026-08-26',
        method: 'flat_tape',
        garment_note:
          'СИНТЕТИКА для показа инструмента. Длины намеренно занижены на 7% — ' +
          'отчёт обязан это найти. Реальными замерами не является.',
        values,
      },
      null,
      2,
    ),
  );
}

console.log(join(root, 'measured'));
