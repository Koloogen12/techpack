import { assume, fromBase, fromPhoto, type Tracked } from '@seamster/core';
import {
  kb as defaultKb,
  type Category,
  type ConstructionNode,
  type KnowledgeBase,
  type TechOperation,
} from '@seamster/kb';
import type { PhotoConfidence } from './pom.js';
import type { ConstructionNodeValue } from '@seamster/stylespec';

/**
 * Движок конструкции: собирает набор узлов обработки и технологическую
 * последовательность.
 *
 * Три правила, каждое из которых закрывает провал конкурента:
 *
 *  R5 — у каждой операции есть код шва, код стежка, SPI и тип машины.
 *       У конкурента этого нет вообще: «вносите вручную».
 *  R6 — узел вне парка машин цеха помечается и заменяется на выполнимый.
 *       Конкурент про оборудование фабрики не знает.
 *  R8 — невидимое с фото уходит предположением с пометкой «уточнить»,
 *       а не подставляется молча.
 */

export interface VisibleElement {
  key: string;
  value: string;
  confidence: PhotoConfidence;
}

export interface TopstitchObservation {
  location: string;
  /** Число параллельных строчек. Прямо задаёт тип машины. */
  rows: number;
  confidence: PhotoConfidence;
}

export interface ConstructionInput {
  category: Category;
  /** Что видно на фото. Приходит из VisionReport.visible_elements. */
  visible_elements?: readonly VisibleElement[];
  /** Наблюдения по отделочным строчкам. Приходит из VisionReport.topstitching. */
  topstitching?: readonly TopstitchObservation[];
  /** Профиль парка машин фабрики. По умолчанию — базовый цех. */
  machine_park?: string;
}

/** Узел в собранном виде — то, что попадает в StyleSpec и в документ. */
/**
 * Узел в собранном виде берётся ИЗ СХЕМЫ, а не описывается здесь заново.
 *
 * Своя копия тут стояла и успела разойтись: у узла появились названия
 * на языках экспорта, а копия про них не знала — движок молча отбрасывал
 * поля, которые схема требует. Это четвёртый случай одного класса ошибки:
 * одна сущность, описанная в двух местах, расходится не «если», а «когда».
 */
export type ConstructionValue = ConstructionNodeValue;

export interface TechSequenceStep {
  step: number;
  operation_ru: string;
  operation_en?: string;
  operation_zh?: string;
  node_id: string | null;
  specialty: string;
  machine: string;
  time_sec: number | null;
}

export interface ConstructionResult {
  nodes: ConstructionValue[];
  sequence: TechSequenceStep[];
  /** Решения, о которых движок обязан сказать вслух. */
  notes: string[];
}

/** Число параллельных строчек низа → узел. Наблюдение прямо задаёт машину. */
const HEM_BY_ROWS: Record<number, string> = {
  2: 'hem_coverstitch',
  3: 'hem_coverstitch_3n',
};

export function buildConstruction(
  input: ConstructionInput,
  base: KnowledgeBase = defaultKb(),
): ConstructionResult {
  const notes: string[] = [];
  const defaults = base.categoryDefaultsFor(input.category);
  const observed = new Map((input.visible_elements ?? []).map((e) => [e.key, e]));

  // --- 1. Замена узла по числу параллельных строчек ---------------------------
  const nodeIds = [...defaults.default_nodes];
  /** Что на что заменили. Нужна, чтобы за узлом последовала техпоследовательность. */
  const substitutions = new Map<string, string>();
  const hemObservation = (input.topstitching ?? []).find((t) => t.location === 'hem');

  if (hemObservation && hemObservation.rows > 0) {
    const wanted = HEM_BY_ROWS[hemObservation.rows];
    const currentIndex = nodeIds.indexOf('hem_coverstitch');
    if (wanted && currentIndex >= 0 && wanted !== 'hem_coverstitch') {
      nodeIds[currentIndex] = wanted;
      substitutions.set('hem_coverstitch', wanted);
      notes.push(
        `На фото видно ${hemObservation.rows} параллельные строчки по низу — это ` +
          `трёхигольный распошив, а не двухигольный. Узел заменён: на фабрике нужна ` +
          `другая машина.`,
      );
    }
  }

  // --- 2. Сборка узлов --------------------------------------------------------
  const nodes = nodeIds.map((id) => buildNode(base.node(id), observed, input, base, notes));

  // --- 3. Технологическая последовательность ----------------------------------
  const sequence = buildSequence(defaults.tech_sequence, nodes, substitutions);

  return { nodes, sequence, notes };
}

function buildNode(
  node: ConstructionNode,
  observed: ReadonlyMap<string, VisibleElement>,
  input: ConstructionInput,
  base: KnowledgeBase,
  notes: string[],
): ConstructionValue {
  const source = `kb:construction_nodes#${node.id}`;

  // --- Присутствие узла: откуда мы знаем, что он в изделии есть ---------------
  let presence: Tracked<boolean>;
  if (!node.visible_on_photo) {
    // Невидимое никогда не утверждается молча. Это половина ценности документа:
    // фабрика видит, где спросить, вместо того чтобы додумать самой.
    const hint = base
      .visibilityMap()
      .not_visible.find((f) => f.key === node.photo_key || f.label_ru === node.label_ru);
    presence = assume(true, source, hint?.note_ru ?? 'уточнить у заказчика или по образцу');
  } else {
    const confirmation = node.photo_key ? observed.get(node.photo_key) : undefined;
    presence = confirmation
      ? fromPhoto(true, `vision:element#${node.photo_key}`, `на фото: ${confirmation.value}`)
      : fromBase(true, source, 'типовой узел категории — подтвердить по образцу');
  }

  // --- Machine-park check (R6) ------------------------------------------------
  const check = base.checkMachinePark(node, input.machine_park);
  let alternative: ConstructionValue['alternative'] = null;

  if (!check.available) {
    if (check.alternative) {
      alternative = {
        node_id: check.alternative.id,
        label_ru: check.alternative.label_ru,
        machine: check.alternative.machine,
      };
      notes.push(
        `Узел «${node.label_ru}» требует машины, которой в типовом цеху обычно нет. ` +
          `Подготовлена замена под базовый парк: «${check.alternative.label_ru}». ` +
          `Подтвердите у фабрики, что делать.`,
      );
    } else {
      notes.push(
        `Узел «${node.label_ru}» требует специального оборудования, и замены под базовый ` +
          `парк у нас нет. Обязательно уточните у фабрики до размещения заказа.`,
      );
    }
  }

  return {
    node_id: node.id,
    zone: node.zone,
    label_ru: node.label_ru,
    label_en: node.label_en,
    label_zh: node.label_zh,
    plain_en: node.plain_en,
    plain_zh: node.plain_zh,
    plain_ru: node.plain_ru,
    seam_code: node.seam_code,
    stitch_code: node.stitch_code,
    spi: node.spi,
    machine: node.machine,
    specialty: node.specialty,
    seam_allowance_cm: assume(
      node.seam_allowance_cm.default,
      `${source}.seam_allowance`,
      'припуски с фото не видны — уточнить у конструктора',
    ),
    finished_cm: node.finished_cm ? fromBase(node.finished_cm.default, `${source}.finished`) : null,
    presence,
    visible_on_photo: node.visible_on_photo,
    requires_special_equipment: !check.available,
    alternative,
  };
}

/**
 * Технологическая последовательность.
 *
 * Порядок операций берётся из категорийных дефолтов — вывести его из набора
 * узлов нельзя. А вот ссылки на узлы и оборудование подставляются из
 * собранного набора: если узел заменили по числу строчек, операция обязана
 * поехать за ним. Иначе документ разъезжается — в конструкции одна машина,
 * в технологической последовательности другая, и фабрика видит противоречие.
 */
function buildSequence(
  operations: readonly TechOperation[],
  nodes: readonly ConstructionValue[],
  substitutions: ReadonlyMap<string, string>,
): TechSequenceStep[] {
  const byId = new Map(nodes.map((n) => [n.node_id, n]));

  return operations
    .map((op) => {
      const nodeId = op.node_id ? (substitutions.get(op.node_id) ?? op.node_id) : null;
      const node = nodeId ? byId.get(nodeId) : undefined;
      return {
        step: op.step,
        operation_ru: op.operation_ru,
        // Перевод едет вместе с операцией: снапшот, отправленный фабрике
        // полгода назад, обязан читаться так же, как читался тогда.
        ...(op.operation_en ? { operation_en: op.operation_en } : {}),
        ...(op.operation_zh ? { operation_zh: op.operation_zh } : {}),
        node_id: nodeId,
        specialty: op.specialty,
        machine: node?.machine ?? op.machine ?? 'manual',
        time_sec: op.time_sec,
      };
    })
    .map((step) => {
      // Операция, ссылающаяся на узел вне документа, — это разъехавшиеся данные.
      // Раньше здесь стоял тихий фолбэк на справочник; он маскировал именно тот
      // баг, который поймал тест: подстановка узла не доезжала до операций.
      // Теперь падаем громко — такую ошибку нельзя увидеть только на фабрике.
      if (step.node_id && !byId.has(step.node_id)) {
        throw new Error(
          `операция ${step.step} ссылается на узел ${step.node_id}, которого нет в наборе. ` +
            `Проверь default_nodes и tech_sequence в категорийных дефолтах`,
        );
      }
      return step;
    });
}

/** Сколько узлов требуют подтверждения по образцу. */
export function countConstructionAssumptions(nodes: readonly ConstructionValue[]): number {
  return nodes.filter((n) => n.presence.confidence === 'assumption').length;
}
