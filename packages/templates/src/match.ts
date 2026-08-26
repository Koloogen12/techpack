import type { Category, FitIntent } from '@seamsterly/kb';
import type { TemplateEntry, TemplateTraits } from './manifest.js';

/**
 * Подбор силуэта из библиотеки под конкретное изделие.
 *
 * Скоринг правилами, а не эмбеддингами: признаки уже извлечены при
 * каталогизации, и сравнивать «капюшон есть» с «капюшон есть» через
 * векторную близость значило бы терять точность там, где ответ известен
 * точно. Веса ниже — это цена ошибки на чертеже: перепутать пуловер с
 * молнией видно любому, перепутать посадку — заметит технолог, перепутать
 * рибану — почти никто.
 */

/** Что мы знаем об изделии к моменту подбора. */
export interface MatchQuery {
  category: Category;
  fit: FitIntent;
  hood: boolean;
  closure: TemplateTraits['closure'];
  pocket: TemplateTraits['pocket'];
  sleeve: TemplateTraits['sleeve'];
  ribbed: boolean;
  /**
   * Отношение ширины к длине из табеля мер.
   *
   * Разрешает ничью: при равенстве признаков ближе тот силуэт, у которого
   * пропорции листа совпадают с пропорциями изделия — кроп не подменит
   * удлинённое худи, хотя по признакам они неразличимы.
   */
  aspect?: number;
}

export interface MatchCandidate {
  entry: TemplateEntry;
  score: number;
  /**
   * Доля совпавших признаков, от нуля до единицы.
   *
   * Именно она отвечает на вопрос «годится ли шаблон», а не место в списке.
   * В библиотеке из сотни худи полсотни совпадают по всем признакам разом,
   * и «лидер обошёл второго на полбалла» не значит ничего — зато «совпало
   * всё, что мы умеем проверить» значит.
   */
  fit_fraction: number;
  /** Из чего сложился счёт — читаемо в CLI и в логе подбора. */
  reasons: string[];
}

/**
 * Родственные категории.
 *
 * Худи и худи на молнии отличаются одной деталью, свитшот и худи — одной
 * деталью тоже. Силуэт-родственник лучше, чем ничего: он даст верную
 * пластику плеча и рукава, а капюшон или молнию дорисует наш слой.
 */
const KIN: Record<Category, readonly Category[]> = {
  tshirt: ['longsleeve', 'polo'],
  longsleeve: ['tshirt', 'sweatshirt'],
  sweatshirt: ['hoodie', 'longsleeve'],
  hoodie: ['zip_hoodie', 'sweatshirt'],
  zip_hoodie: ['hoodie', 'sweatshirt'],
  polo: ['tshirt'],
  tank_top: ['tshirt'],
};

/** Порядок посадок: соседняя посадка — половина ошибки, противоположная — целая. */
const FIT_ORDER: readonly FitIntent[] = ['fitted', 'semi_fitted', 'loose', 'oversize'];

const WEIGHTS = {
  categoryExact: 40,
  categoryKin: 18,
  fitExact: 14,
  fitNear: 7,
  hood: 20,
  closure: 16,
  pocket: 8,
  sleeve: 10,
  ribbed: 4,
  confidenceHigh: 3,
} as const;

/**
 * Наибольший счёт по признакам, без разрешения ничьих.
 *
 * Знаменатель доли совпадения: сумма весов всего, что мы умеем сверить.
 * Пропорции и частота выбора сюда не входят — они разводят равных, а не
 * говорят о пригодности.
 */
const MAX_TRAIT_SCORE =
  WEIGHTS.categoryExact +
  WEIGHTS.fitExact +
  WEIGHTS.hood +
  WEIGHTS.closure +
  WEIGHTS.pocket +
  WEIGHTS.sleeve +
  WEIGHTS.ribbed +
  WEIGHTS.confidenceHigh;

export function scoreTemplate(entry: TemplateEntry, query: MatchQuery): MatchCandidate | null {
  const t = entry.traits;
  // Неразобранный шаблон в подбор не идёт: о нём известна только геометрия,
  // и поставить его в один ряд с опознанными означало бы выдать случайный
  // силуэт за подходящий.
  if (!t) return null;

  // Без вида спинки шаблон в библиотеку не годится. Техпак с одним видом
  // неполон: фабрике негде посмотреть кокетку, шов спинки и посадку
  // капюшона. Датасет отдаёт каждое изделие тройкой — лист с двумя видами
  // и два отдельных, — поэтому требование ничего не теряет: полный лист
  // есть почти у каждого силуэта.
  if (!entry.svg_back) return null;

  let score = 0;
  const reasons: string[] = [];

  if (t.category === query.category) {
    score += WEIGHTS.categoryExact;
    reasons.push('категория совпала');
  } else if (t.category && KIN[query.category].includes(t.category)) {
    score += WEIGHTS.categoryKin;
    reasons.push(`родственная категория (${t.category})`);
  } else {
    // Чужая категория — не кандидат вовсе. Масштабировать брюки под худи
    // технически можно, и именно поэтому нужен явный отказ.
    return null;
  }

  if (t.fit === query.fit) {
    score += WEIGHTS.fitExact;
    reasons.push('посадка совпала');
  } else if (t.fit) {
    const d = Math.abs(FIT_ORDER.indexOf(t.fit) - FIT_ORDER.indexOf(query.fit));
    if (d === 1) {
      score += WEIGHTS.fitNear;
      reasons.push(`посадка рядом (${t.fit})`);
    }
  }

  if (t.hood === query.hood) {
    score += WEIGHTS.hood;
    reasons.push(query.hood ? 'капюшон есть' : 'без капюшона');
  }
  if (t.closure === query.closure) {
    score += WEIGHTS.closure;
    reasons.push(`застёжка: ${t.closure}`);
  }
  if (t.pocket === query.pocket) {
    score += WEIGHTS.pocket;
    reasons.push(`карман: ${t.pocket}`);
  }
  if (t.sleeve === query.sleeve) {
    score += WEIGHTS.sleeve;
    reasons.push(`рукав: ${t.sleeve}`);
  }
  if (t.ribbed === query.ribbed) score += WEIGHTS.ribbed;

  if (t.confidence === 'high') score += WEIGHTS.confidenceHigh;

  const traitScore = score;

  // Пропорции разрешают ничью, а не решают исход: вес мал намеренно.
  if (query.aspect && entry.aspect > 0) {
    const ratio = Math.max(query.aspect, entry.aspect) / Math.min(query.aspect, entry.aspect);
    score += Math.max(0, 6 - (ratio - 1) * 30);
  }

  // Частота выбора — последний разряд счёта: при прочих равных выигрывает
  // силуэт, который люди уже выбирали, а не первый по алфавиту.
  score += Math.min(2, (entry.promotion_score ?? 0) * 0.1);

  return {
    entry,
    score: Math.round(score * 100) / 100,
    fit_fraction: Math.round((traitScore / MAX_TRAIT_SCORE) * 1000) / 1000,
    reasons,
  };
}

export interface MatchResult {
  /** Лучший кандидат или ничего, если библиотека не предложила ни одного. */
  best: MatchCandidate | null;
  /** Топ для показа пользователю: «какой силуэт ближе?». */
  candidates: MatchCandidate[];
  /**
   * Отрыв лидера от второго места.
   *
   * Диагностика, а не критерий. При большой библиотеке отрыв всегда мал —
   * не потому что подбор плох, а потому что подходящих силуэтов много.
   */
  margin: number;
}

export function matchTemplates(
  entries: readonly TemplateEntry[],
  query: MatchQuery,
  top = 3,
): MatchResult {
  const scored = entries
    .map((e) => scoreTemplate(e, query))
    .filter((c): c is MatchCandidate => c !== null)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));

  const best = scored[0] ?? null;
  const margin = scored.length > 1 ? Math.round((scored[0]!.score - scored[1]!.score) * 100) / 100 : 0;
  return { best, candidates: scored.slice(0, top), margin };
}

/**
 * Порог автоподбора: какая доля признаков должна совпасть.
 *
 * Девять десятых означают, что разошлось не больше одной мелкой детали —
 * рибаны или уверенности каталогизатора. Категория, капюшон, застёжка и
 * рукав весят столько, что промах любого из них уводит долю ниже порога
 * сам по себе. Ниже порога силуэт всё равно показывается человеком, но
 * молча в документ не идёт.
 */
export const AUTO_FIT_FRACTION = 0.9;

export function isConfident(result: MatchResult): boolean {
  return result.best !== null && result.best.fit_fraction >= AUTO_FIT_FRACTION;
}
