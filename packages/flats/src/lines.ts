import { kb as defaultKb, type KnowledgeBase } from '@specform/kb';
import type { StyleSpec } from '@specform/stylespec';

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

export function checkFlatLines(
  spec: StyleSpec,
  svgs: readonly string[],
  base: KnowledgeBase = defaultKb(),
): LineCheck {
  const drawn = new Set<string>();
  for (const svg of svgs) {
    for (const m of svg.matchAll(/data-line="([a-z_]+)"/g)) drawn.add(m[1]!);
  }

  const missing: LineCheck['missing'] = [];
  for (const node of spec.construction?.nodes ?? []) {
    const entry = base.node(node.node_id);
    if (entry.flat_line === null) continue;
    if (!drawn.has(entry.flat_line)) {
      missing.push({
        node_id: node.node_id,
        label_ru: node.label_ru,
        expected: entry.flat_line,
      });
    }
  }

  const expected = new Set(
    (spec.construction?.nodes ?? [])
      .map((n) => base.node(n.node_id).flat_line)
      .filter((l): l is string => l !== null),
  );
  const orphan = [...drawn].filter((l) => !expected.has(l) && !NOT_A_NODE.has(l)).sort();

  return { missing, orphan, ok: missing.length === 0 && orphan.length === 0 };
}
