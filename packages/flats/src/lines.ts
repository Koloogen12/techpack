import { kb as defaultKb, type KnowledgeBase, type NodeZone } from '@seamsterly/kb';
import type { StyleSpec } from '@seamsterly/stylespec';

/**
 * Проверка связи «узел обработки ↔ линия на чертеже».
 *
 * Технолог читает чертёж швами. Узел, который есть в разделе конструкции
 * и отсутствует на рисунке, делает документ противоречащим самому себе:
 * первый же вопрос с фабрики будет «где шов проймы», и ответить на него
 * нечем. Обратное так же плохо — линия, за которой не стоит узла, обещает
 * обработку, которой в спецификации нет.
 *
 * Проверка идёт по РЕНДЕРУ, а не по данным: важно не то, что мы собирались
 * нарисовать, а то, что попало в файл. Каждая линия чертежа помечена
 * `data-line`, и здесь сверяются два множества.
 *
 * У библиотечного силуэта линий швов в нашей разметке нет — есть зоны.
 * Требование от этого не отменяется, а смягчается: вместо «узел со швом →
 * линия» проверяется «узел со швом → зона». Совсем отключить проверку
 * значило бы позволить документу противоречить самому себе там, где его
 * читают чаще всего.
 */
export interface LineCheck {
  /** Узлы конструкции, которым на чертеже не нашлось линии. */
  missing: { node_id: string; label_ru: string; expected: string }[];
  /** Линии чертежа, за которыми не стоит ни одного узла конструкции. */
  orphan: string[];
  ok: boolean;
}

/**
 * Линии, законно существующие без узла обработки.
 *
 * Это не швы: центр переда — вспомогательная ось, контур капюшона и шнур —
 * край детали и фурнитура. Список закрытый намеренно, чтобы новая линия
 * не проскочила молча.
 */
const NOT_A_NODE = new Set(['outline', 'hood_outline', 'hood_drawcord', 'side_seam', 'neck_band']);

/**
 * Зоны, которые на чертеже не показать.
 *
 * Маркировка — это ярлыки, а не геометрия: где именно вшит размерник,
 * говорит раздел маркировки, а не силуэт.
 */
const NOT_ON_FLAT = new Set<NodeZone>(['labels']);

export interface LineCheckOptions {
  base?: KnowledgeBase;
  /**
   * Чем держится связь узла с чертежом.
   *
   * `line` — линией шва (наше построение), `zone` — зоной изделия
   * (библиотечный силуэт, у которого контрольных точек нет).
   */
  mode?: 'line' | 'zone';
}

export function checkFlatLines(
  spec: StyleSpec,
  svgs: readonly string[],
  options: LineCheckOptions = {},
): LineCheck {
  const base = options.base ?? defaultKb();
  const zoneMode = options.mode === 'zone';
  const attribute = zoneMode ? /data-zone="([a-z_]+)"/g : /data-line="([a-z_]+)"/g;

  const drawn = new Set<string>();
  for (const svg of svgs) {
    for (const m of svg.matchAll(attribute)) drawn.add(m[1]!);
  }

  /** Чего мы ждём от чертежа для этого узла: линию шва или зону. */
  const wanted = (node_id: string, zone: NodeZone): string | null => {
    const entry = base.node(node_id);
    // Узел без линии шва не рисуется ни в каком режиме: это, например,
    // вшивание ярлыка — работа есть, геометрии на чертеже нет.
    if (entry.flat_line === null) return null;
    if (!zoneMode) return entry.flat_line;
    return NOT_ON_FLAT.has(zone) ? null : zone;
  };

  const missing: LineCheck['missing'] = [];
  const expected = new Set<string>();
  for (const node of spec.construction?.nodes ?? []) {
    const want = wanted(node.node_id, node.zone as NodeZone);
    if (want === null) continue;
    expected.add(want);
    if (!drawn.has(want)) {
      missing.push({ node_id: node.node_id, label_ru: node.label_ru, expected: want });
    }
  }

  // Вспомогательные линии законны без узла; зоны — нет. Выноска на зону,
  // за которой не стоит ни одного узла, обещает обработку, которой в
  // спецификации не описано.
  const orphan = [...drawn]
    .filter((l) => !expected.has(l) && (zoneMode || !NOT_A_NODE.has(l)))
    .sort();

  return { missing, orphan, ok: missing.length === 0 && orphan.length === 0 };
}
