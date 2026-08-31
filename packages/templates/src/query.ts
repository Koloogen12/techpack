import type { Category } from '@seamster/kb';
import type { StyleSpec } from '@seamster/stylespec';
import type { VisionReport } from '@seamster/vision';
import type { MatchQuery } from './match.js';
import type { TemplateTraits } from './manifest.js';

/**
 * Что искать в библиотеке — выводится из уже собранной спеки.
 *
 * Не из отчёта зрения напрямую: к моменту подбора спека прошла сборку,
 * а значит пережила и правки пользователя, и гейты справочника. Отчёт
 * добавляется сверху как источник деталей, которых в табеле мер нет
 * (какой карман, какой рукав), и только там, где сам умеет их назвать.
 */

const SLEEVE_BY_CATEGORY: Record<Category, TemplateTraits['sleeve']> = {
  tshirt: 'short',
  polo: 'short',
  tank_top: 'none',
  longsleeve: 'long',
  sweatshirt: 'long',
  hoodie: 'long',
  zip_hoodie: 'long',
};

const CLOSURE_BY_CATEGORY: Record<Category, TemplateTraits['closure']> = {
  tshirt: 'none',
  longsleeve: 'none',
  sweatshirt: 'none',
  hoodie: 'none',
  zip_hoodie: 'full_zip',
  polo: 'buttons',
  tank_top: 'none',
};

export interface QueryOptions {
  /** Отчёт зрения — уточняет детали, которых нет в табеле мер. */
  report?: VisionReport;
  /**
   * Пропорция листа нашего собственного чертежа (ширина к высоте).
   *
   * Передаётся снаружи намеренно. Пропорция листа — это в первую очередь
   * свойство КОНВЕНЦИИ РИСУНКА: угол отведения рукава меняет её сильнее,
   * чем длина изделия. Сравнивать с габаритом шаблона осмысленно только
   * то, что построено по той же конвенции, — то есть наш же чертёж.
   */
  aspect?: number;
}

const has = (spec: StyleSpec, code: string): boolean =>
  spec.measurements.points.some((p) => p.code === code);

export function queryFromSpec(spec: StyleSpec, options: QueryOptions = {}): MatchQuery {
  const category = spec.style.category as Category;

  // Карман: сначала спрашиваем табель — если у изделия есть замеры кармана,
  // он на нём точно есть. Тип берём из отчёта зрения, а если тот молчит —
  // из категории: у пуловера-худи карман кенгуру, у остальных накладной.
  const hasPocket = has(spec, 'H04') || has(spec, 'H05') || has(spec, 'H09') || has(spec, 'H10');
  const seen = (key: string): string | undefined =>
    options.report?.visible_elements.find((e) => e.key === key)?.value;
  const pocketSeen = seen('pocket_type') ?? seen('pocket');
  const pocket: TemplateTraits['pocket'] = !hasPocket
    ? 'none'
    : pocketSeen?.includes('kangaroo') || pocketSeen?.includes('кенгуру')
      ? 'kangaroo'
      : pocketSeen?.includes('welt')
        ? 'welt'
        : pocketSeen?.includes('patch') || pocketSeen?.includes('наклад')
          ? 'patch'
          : category === 'hoodie'
            ? 'kangaroo'
            : 'patch';

  const query: MatchQuery = {
    category,
    fit: spec.base.fit_intent,
    // Капюшон читается по замеру, а не по названию категории: свитшот
    // с капюшоном — это уже худи, и решает это табель мер, а не ярлык.
    hood: has(spec, 'H01'),
    closure: CLOSURE_BY_CATEGORY[category],
    pocket,
    sleeve: SLEEVE_BY_CATEGORY[category],
    ribbed: has(spec, 'H07') || has(spec, 'H08'),
  };
  return options.aspect ? { ...query, aspect: options.aspect } : query;
}
