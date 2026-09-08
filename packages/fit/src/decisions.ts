import { CONFIDENCE_LABEL_RU, track, type Confidence } from '@seamster/core';
import { kb as defaultKb, type KnowledgeBase } from '@seamster/kb';
import { parseStyleSpec, type StyleSpec } from '@seamster/stylespec';
import { editMeasurement } from './edit.js';

/**
 * Очередь открытых решений.
 *
 * Документ помечает уверенность каждого значения — пять уровней, легенда на
 * каждом листе. Но пометки разбросаны по двадцати листам, и человек, которому
 * надо «пройти и подтвердить», листает документ глазами. Здесь всё, что
 * требует его слова, собрано в один список с тремя действиями: подтвердить,
 * исправить, убрать.
 *
 * Список — ПРОЕКЦИЯ спеки, а не отдельная сущность. Подтверждение меняет
 * уверенность значения в самой спеке, и решение исчезает из очереди потому,
 * что исчез его повод. Хранится отдельно только то, что в спеке выразить
 * нечем: снятые с повестки расхождения.
 *
 * Четыре рода решений:
 *  - расхождение — фото и анкета разошлись, документ собран по анкете;
 *  - предположение — значение поставлено без опоры на фото и справочник;
 *  - нужен ввод — данных нет вовсе, и взять их можно только у бренда;
 *  - подтверждено — уже решено, показывается для счёта.
 */

export type DecisionKind = 'conflict' | 'assumption' | 'needs_input' | 'confirmed';

export type DecisionAction = 'confirm' | 'edit' | 'dismiss';

export interface Decision {
  /** Стабильный: 'pom:T05', 'node:kangaroo_pocket', 'bom:L03', 'conflict:category', 'input:country'. */
  id: string;
  kind: DecisionKind;
  title_ru: string;
  detail_ru: string;
  /** Раздел кабинета, куда ведёт решение. */
  section: 'pom' | 'nodes' | 'bom' | 'labels' | 'cover' | 'flats';
  /** Какие действия применимы именно к этому решению. */
  actions: readonly DecisionAction[];
  /** Текущее значение — для поля «исправить». */
  value?: { current: string | number; unit?: string };
  /** Держит ли решение экспорт. */
  blocking: boolean;
}

export interface DecisionsSummary {
  open: number;
  blocking: number;
  confirmed: number;
  by_kind: Record<DecisionKind, number>;
  /** Можно ли отдавать документ наружу. */
  ready: boolean;
  /**
   * Готовность к фабрике, 0…10 — рубрика: расхождения сняты (2), реквизиты
   * маркировки заполнены (2), предположения подтверждены (доля от 2),
   * масштаб измерен (2) или назначен (1), спинка есть (1), эскиз принят (1).
   * Число нужно, чтобы видеть движение, а не чтобы спорить о десятых.
   */
  score: number;
  /** Что закрыть следующим. */
  next_ru: string | null;
}

export interface DecisionsContext {
  /** Примечания сборки — из них читаются расхождения. */
  notes?: readonly string[];
  /** Идентификаторы решений, снятых с повестки человеком. */
  resolved?: readonly string[];
  /** Ракурсы присланных фото — спека их не хранит. */
  photoViews?: readonly string[];
}

/**
 * Префиксы примечаний, которые сборка пишет при расхождении фото и анкеты.
 *
 * Очередь узнаёт расхождение по префиксу, а не по полному тексту: текст
 * объясняет, префикс адресует. Меняется префикс — меняется здесь и в сборке
 * разом, на это есть тест.
 */
export const CONFLICT_PREFIXES: Record<string, { id: string; title_ru: string }> = {
  'Расхождение по категории:': {
    id: 'conflict:category',
    title_ru: 'Категория на фото не та, что в анкете',
  },
  'Расхождение по материалу:': {
    id: 'conflict:fabric',
    title_ru: 'Материал на фото не тот, что в анкете',
  },
  'Расхождение по посадке:': {
    id: 'conflict:fit',
    title_ru: 'Посадка на фото не та, что в анкете',
  },
  'Технический эскиз не принят:': {
    id: 'conflict:sketch',
    title_ru: 'Эскиз разошёлся со спецификацией',
  },
};

/** Те же префиксы, адресуемые по смыслу — сборка пишет примечания ими. */
export const CONFLICT_PREFIX = {
  category: 'Расхождение по категории:',
  fabric: 'Расхождение по материалу:',
  fit: 'Расхождение по посадке:',
  sketch: 'Технический эскиз не принят:',
} as const;

const RESOLVED_SOURCE = 'user:review';

export function openDecisions(
  spec: StyleSpec,
  ctx: DecisionsContext = {},
  base: KnowledgeBase = defaultKb(),
): { decisions: Decision[]; summary: DecisionsSummary } {
  const resolved = new Set(ctx.resolved ?? []);
  const out: Decision[] = [];

  // --- расхождения: из примечаний сборки
  for (const note of ctx.notes ?? []) {
    const hit = Object.entries(CONFLICT_PREFIXES).find(([prefix]) => note.startsWith(prefix));
    if (!hit) continue;
    const [prefix, meta] = hit;
    if (resolved.has(meta.id)) continue;
    out.push({
      id: meta.id,
      kind: 'conflict',
      title_ru: meta.title_ru,
      detail_ru: note.slice(prefix.length).trim(),
      section: meta.id === 'conflict:sketch' ? 'flats' : 'cover',
      // «Подтвердить» здесь значит «документ верен, оставить как есть»:
      // другой ответ анкеты — это другая сборка, а не правка поля.
      actions: ['confirm'],
      blocking: true,
    });
  }

  // --- нужен ввод: реквизиты, которые заполняет только бренд
  const byBrand = new Set(
    base
      .labelRequisites()
      .filter((r) => r.required && r.fills_from === 'brand_profile')
      .map((r) => r.id),
  );
  for (const r of spec.labels?.requisites ?? []) {
    if (!r.required || r.value !== null || !byBrand.has(r.id)) continue;
    out.push({
      id: `input:${r.id}`,
      kind: 'needs_input',
      title_ru: r.label_ru,
      detail_ru: r.action_ru ?? 'Заполните профиль бренда — это нужно один раз.',
      section: 'labels',
      actions: [],
      blocking: true,
    });
  }

  // --- нужен ввод: масштаб назначен, а не измерен
  const measured = spec.measurements.points.some((p) => p.base.confidence === 'measured_by_scale');
  if (!measured && !resolved.has('input:scale')) {
    out.push({
      id: 'input:scale',
      kind: 'needs_input',
      title_ru: 'Масштаб задан размером, а не измерен',
      detail_ru:
        'Ширина по груди взята из размерной сетки и типовой прибавки, от неё считается весь табель. ' +
        'Положите в кадр лист А4 и переснимите — тогда ширина снимется с фотографии.',
      section: 'pom',
      actions: ['dismiss'],
      blocking: false,
    });
  }

  // --- нужен ввод: спинки нет
  const views = ctx.photoViews ?? [];
  if (
    views.length > 0 &&
    !views.some((v) => v.startsWith('back')) &&
    !resolved.has('input:back_photo')
  ) {
    out.push({
      id: 'input:back_photo',
      kind: 'needs_input',
      title_ru: 'Нет фото спинки',
      detail_ru:
        'Спинка, кокетка и шов капюшона взяты типовыми для категории. Добавьте снимок спинки ' +
        'и соберите документ заново — узлы спинки подтвердятся по фото.',
      section: 'cover',
      actions: ['dismiss'],
      blocking: false,
    });
  }

  // --- предположения: табель
  for (const p of spec.measurements.points) {
    const baseGuess = p.base.confidence === 'assumption';
    const tolGuess = p.tolerance.confidence === 'assumption';
    if (!baseGuess && !tolGuess) continue;
    out.push({
      id: `pom:${p.code}`,
      kind: 'assumption',
      title_ru: `${p.code} · ${p.name_ru}`,
      detail_ru: baseGuess
        ? (p.base.note ??
          'Значение поставлено без опоры на фото. Сверьте по образцу или укажите своё.')
        : (p.tolerance.note ??
          'Допуск взят из практики, а не из стандарта. Сверьте с приёмкой фабрики.'),
      section: 'pom',
      actions: baseGuess ? ['confirm', 'edit'] : ['confirm'],
      value: { current: p.base.value, unit: 'см' },
      blocking: false,
    });
  }

  // --- предположения: узлы
  for (const n of spec.construction?.nodes ?? []) {
    if (n.presence.confidence !== 'assumption') continue;
    out.push({
      id: `node:${n.node_id}`,
      kind: 'assumption',
      title_ru: n.label_ru,
      detail_ru:
        n.presence.note ?? `На фото узел не виден — взят как типовой для категории. ${n.plain_ru}`,
      section: 'nodes',
      actions: ['confirm', 'dismiss'],
      blocking: false,
    });
  }

  // --- предположения: материалы
  for (const l of spec.bom?.lines ?? []) {
    const compGuess = l.composition.confidence === 'assumption';
    const gsmGuess = l.gsm?.confidence === 'assumption';
    if (!compGuess && !gsmGuess) continue;
    out.push({
      id: `bom:${l.code}`,
      kind: 'assumption',
      title_ru: l.name_ru,
      detail_ru: compGuess
        ? (l.composition.note ?? `Состав «${l.composition.value}» предположен по фактуре на фото.`)
        : (l.gsm?.note ?? `Плотность ${l.gsm?.value} г/м² предположена, на фото она не читается.`),
      section: 'bom',
      actions: compGuess ? ['confirm', 'edit'] : ['confirm'],
      value: compGuess
        ? { current: l.composition.value }
        : { current: l.gsm?.value ?? 0, unit: 'г/м²' },
      blocking: false,
    });
  }

  // --- подтверждённое: для счёта и ощущения движения
  const confirmedCount =
    spec.measurements.points.filter((p) => isSettled(p.base.confidence)).length +
    (spec.construction?.nodes.filter((n) => isSettled(n.presence.confidence)).length ?? 0) +
    (spec.bom?.lines.filter((l) => isSettled(l.composition.confidence)).length ?? 0);

  const by_kind: Record<DecisionKind, number> = {
    conflict: 0,
    assumption: 0,
    needs_input: 0,
    confirmed: 0,
  };
  for (const d of out) by_kind[d.kind] += 1;
  by_kind.confirmed = confirmedCount;

  const blocking = out.filter((d) => d.blocking).length;
  const assumptions = by_kind.assumption;

  // Готовность — рубрика из шести статей, а не одна формула: каждая статья
  // отвечает на свой вопрос фабрики, и число растёт только от закрытых
  // решений. Свежий пак без профиля бренда — около 5; профиль заполнен — 7;
  // предположения подтверждены — 9; масштаб измерен по А4 — 10.
  const conflicts = by_kind.conflict;
  const labelGaps = out.filter((d) => d.kind === 'needs_input' && d.section === 'labels').length;
  const settledShare =
    assumptions + confirmedCount === 0 ? 1 : confirmedCount / (assumptions + confirmedCount);
  const score =
    (conflicts === 0 ? 2 : 0) +
    Math.max(0, 2 - labelGaps) +
    2 * settledShare +
    (measured ? 2 : 1) +
    (out.some((d) => d.id === 'input:back_photo') ? 0 : 1) +
    (out.some((d) => d.id === 'conflict:sketch') ? 0 : 1);
  const next = out.find((d) => d.blocking) ?? out[0];

  return {
    decisions: out,
    summary: {
      open: out.length,
      blocking,
      confirmed: confirmedCount,
      by_kind,
      ready: blocking === 0,
      score: Math.round(score * 10) / 10,
      next_ru: next ? next.title_ru : null,
    },
  };
}

function isSettled(c: Confidence): boolean {
  return c === 'fit_confirmed' || c === 'user_input';
}

export interface ApplyResult {
  spec: StyleSpec;
  /** Решение снято с повестки без правки спеки — запомнить снаружи. */
  resolved: string | null;
  rejected: string | null;
  /** Что изменилось человеческими словами — для журнала и тоста. */
  changed_ru: string | null;
}

/**
 * Применить действие к решению.
 *
 * Подтверждение поднимает уверенность до «указано вами»: человек посмотрел и
 * сказал «да». Это честнее, чем «подтверждено по образцу», — образец он,
 * возможно, не мерил. Исправление идёт тем же путём, что правка в таблице:
 * составные точки пересчитываются, градация сдвигается.
 */
export function applyDecision(
  spec: StyleSpec,
  id: string,
  action: DecisionAction,
  value?: string | number,
  base: KnowledgeBase = defaultKb(),
): ApplyResult {
  const [kind, key] = id.split(':', 2) as [string, string | undefined];
  if (!key) return { spec, resolved: null, rejected: 'неизвестное решение', changed_ru: null };

  if (kind === 'conflict' || kind === 'input') {
    if (kind === 'input' && !(key === 'scale' || key === 'back_photo'))
      return {
        spec,
        resolved: null,
        rejected: 'этот пробел закрывается профилем бренда',
        changed_ru: null,
      };
    return { spec, resolved: id, rejected: null, changed_ru: 'снято с повестки' };
  }

  if (kind === 'pom') {
    const point = spec.measurements.points.find((p) => p.code === key);
    if (!point)
      return {
        spec,
        resolved: null,
        rejected: `точки ${key} нет в этом изделии`,
        changed_ru: null,
      };
    if (action === 'edit') {
      const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
      const r = editMeasurement(spec, key, n, base);
      return r.rejected
        ? { spec, resolved: null, rejected: r.rejected, changed_ru: null }
        : {
            spec: r.spec,
            resolved: null,
            rejected: null,
            changed_ru: `${key}: ${point.base.value} → ${n} см`,
          };
    }
    if (action === 'confirm') {
      const points = spec.measurements.points.map((p) =>
        p.code !== key
          ? p
          : {
              ...p,
              base: settle(p.base),
              tolerance: settle(p.tolerance),
            },
      );
      return {
        spec: withAssumptionCount({ ...spec, measurements: { ...spec.measurements, points } }),
        resolved: null,
        rejected: null,
        changed_ru: `${key}: ${CONFIDENCE_LABEL_RU.user_input}`,
      };
    }
    return { spec, resolved: null, rejected: 'точку табеля нельзя убрать', changed_ru: null };
  }

  if (kind === 'node') {
    const nodes = spec.construction?.nodes ?? [];
    const node = nodes.find((n) => n.node_id === key);
    if (!node || !spec.construction)
      return { spec, resolved: null, rejected: `узла ${key} нет в этом изделии`, changed_ru: null };
    if (action === 'confirm') {
      const next = nodes.map((n) =>
        n.node_id !== key ? n : { ...n, presence: settle(n.presence) },
      );
      return {
        spec: withAssumptionCount({ ...spec, construction: { ...spec.construction, nodes: next } }),
        resolved: null,
        rejected: null,
        changed_ru: `${node.label_ru}: ${CONFIDENCE_LABEL_RU.user_input}`,
      };
    }
    if (action === 'dismiss') {
      // Узел уходит вместе со своими операциями: техпоследовательность
      // не имеет права ссылаться на то, чего в изделии нет.
      const next = nodes.filter((n) => n.node_id !== key);
      const sequence = spec.construction.sequence
        .filter((s) => s.node_id !== key)
        .map((s, i) => ({ ...s, step: i + 1 }));
      if (next.length === 0 || sequence.length === 0)
        return { spec, resolved: null, rejected: 'последний узел убрать нельзя', changed_ru: null };
      return {
        spec: withAssumptionCount({
          ...spec,
          construction: { ...spec.construction, nodes: next, sequence },
        }),
        resolved: null,
        rejected: null,
        changed_ru: `${node.label_ru}: убран из изделия`,
      };
    }
    return { spec, resolved: null, rejected: 'узел не правится числом', changed_ru: null };
  }

  if (kind === 'bom') {
    const lines = spec.bom?.lines ?? [];
    const line = lines.find((l) => l.code === key);
    if (!line || !spec.bom)
      return {
        spec,
        resolved: null,
        rejected: `позиции ${key} нет в спецификации`,
        changed_ru: null,
      };
    if (action === 'confirm') {
      const next = lines.map((l) =>
        l.code !== key
          ? l
          : { ...l, composition: settle(l.composition), gsm: l.gsm ? settle(l.gsm) : l.gsm },
      );
      return {
        spec: withAssumptionCount({ ...spec, bom: { ...spec.bom, lines: next } }),
        resolved: null,
        rejected: null,
        changed_ru: `${line.name_ru}: ${CONFIDENCE_LABEL_RU.user_input}`,
      };
    }
    if (action === 'edit') {
      const text = String(value ?? '').trim();
      if (!text) return { spec, resolved: null, rejected: 'укажите состав', changed_ru: null };
      const next = lines.map((l) =>
        l.code !== key
          ? l
          : {
              ...l,
              composition: track(
                text,
                'user_input' as const,
                RESOLVED_SOURCE,
                'исправлено в очереди решений',
              ),
            },
      );
      return {
        spec: withAssumptionCount({ ...spec, bom: { ...spec.bom, lines: next } }),
        resolved: null,
        rejected: null,
        changed_ru: `${line.name_ru}: состав → ${text}`,
      };
    }
    return {
      spec,
      resolved: null,
      rejected: 'позицию спецификации нельзя убрать отсюда',
      changed_ru: null,
    };
  }

  return { spec, resolved: null, rejected: 'неизвестное решение', changed_ru: null };
}

/** Форма, в которой значение приходит из zod: note может быть undefined явно. */
type Loose<T> = { value: T; confidence: Confidence; source: string; note?: string | undefined };

function settle<T>(t: Loose<T>): Loose<T> {
  if (t.confidence !== 'assumption') return t;
  return track(t.value, 'user_input' as const, RESOLVED_SOURCE, 'подтверждено в очереди решений');
}

/**
 * Счётчик предположений — проекция данных, и схема это проверяет.
 * Любая правка уверенности обязана пересчитать его, иначе спека не загрузится.
 */
function withAssumptionCount(draft: StyleSpec): StyleSpec {
  const count =
    draft.measurements.points.filter(
      (p) => p.base.confidence === 'assumption' || p.tolerance.confidence === 'assumption',
    ).length +
    (draft.construction?.nodes.filter((n) => n.presence.confidence === 'assumption').length ?? 0) +
    (draft.bom?.lines.filter(
      (l) => l.composition.confidence === 'assumption' || l.gsm?.confidence === 'assumption',
    ).length ?? 0);
  return parseStyleSpec({ ...draft, meta: { ...draft.meta, assumptions_count: count } });
}
