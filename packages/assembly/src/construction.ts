import {
  assume,
  fromBase,
  fromPhoto,
  userInput,
  type Observations,
  type Tracked,
} from '@seamster/core';
import {
  kb as defaultKb,
  type Category,
  type ConstructionNode,
  type FabricKind,
  type KnowledgeBase,
  type TechOperation,
} from '@seamster/kb';
import type { PhotoConfidence } from './pom.js';
import type { ConstructionNodeValue } from '@seamster/stylespec';
import { planFromObservations } from './observations.js';

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
  /**
   * Наблюдения по закрытым словарям (VisionReport.observations). Есть — узлы
   * выбираются по ним детерминированно; нет — по свободному тексту
   * visible_elements, регулярками (старые отчёты).
   */
  observations?: Observations;
  /**
   * Полотно. Набор узлов у одной категории от него меняется целиком:
   * трикотажное платье собирается оверлоком и распошивом, тканое —
   * стачным швом, вытачками, обтачкой и потайной молнией.
   */
  fabric_kind: FabricKind;
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
  const defaults = base.categoryDefaultsFor(input.category, input.fabric_kind);
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

  // --- 1b. Застёжка по фото: молния вместо планки с пуговицами ---------------
  //
  // Категория даёт типовую застёжку: у кардигана это планка с петлями и
  // пуговицами. Снимок сильнее категории: если взгляд увидел молнию, узлы
  // планки заменяются на втачивание молнии, петли и пуговицы уходят вместе
  // со своими операциями. Без этого документ рисовал ОБЕ застёжки разом —
  // пуговицы из справочника и молнию из дизайн-признаков (джемпер с
  // диагональной молнией, 23.09.2026).
  const dropped = new Set<string>();
  const added: string[] = [];

  // --- 1a. Наблюдения по словарям: узлы выбираются детерминированно ----------
  //
  // Есть словари — свободный текст ниже не читается вовсе: две дороги к
  // одному узлу дают два ответа. Правила — в observations.ts.
  if (input.observations) {
    const plan = planFromObservations(
      input.observations,
      input.category,
      input.fabric_kind,
      nodeIds,
      base,
    );
    for (const [from, to] of plan.swap) {
      const at = nodeIds.indexOf(from);
      if (at >= 0) {
        nodeIds[at] = to;
        substitutions.set(from, to);
      }
    }
    for (const id of plan.drop) {
      const at = nodeIds.indexOf(id);
      if (at >= 0) {
        nodeIds.splice(at, 1);
        dropped.add(id);
      }
    }
    for (const id of plan.add) {
      // Застёжка и горловина — за узлами горловины, остальное — перед ярлыками:
      // документ перечисляет узлы в порядке сборки.
      const neckAt = nodeIds.reduce((last, n, i) => (/^neck_|^hood_/.test(n) ? i : last), -1);
      const labelAt = nodeIds.findIndex((n) => /_label_/.test(n));
      const at = /^(zip_|cardigan_placket|placket_|button_|neck_|hood_|invisible_zip)/.test(id)
        ? neckAt + 1
        : labelAt >= 0
          ? labelAt
          : nodeIds.length;
      nodeIds.splice(at, 0, id);
      added.push(id);
    }
    notes.push(...plan.notes);
  }

  const closure = input.observations ? undefined : observed.get('closure_type');
  if (closure && seesZip(closure.value) && nodeIds.includes('cardigan_placket')) {
    const applicable = new Set(base.nodesFor(input.category).map((n) => n.id));
    if (applicable.has('zip_set_in')) {
      const swap: [string, string][] = [
        ['cardigan_placket', 'zip_set_in'],
        ['cardigan_placket_topstitch', 'zip_placket_topstitch'],
      ];
      for (const [from, to] of swap) {
        const at = nodeIds.indexOf(from);
        if (at >= 0 && applicable.has(to)) {
          nodeIds[at] = to;
          substitutions.set(from, to);
        }
      }
      for (const id of ['placket_buttonholes', 'button_sew']) {
        const at = nodeIds.indexOf(id);
        if (at >= 0) {
          nodeIds.splice(at, 1);
          dropped.add(id);
        }
      }
      notes.push(
        `На фото застёжка — молния (${closure.value}), а не планка с пуговицами из ` +
          `типового набора категории. Узлы планки заменены на втачивание разъёмной ` +
          `молнии, петли и пуговицы убраны вместе с операциями. Асимметрию и ход ` +
          `молнии смотрите в дизайн-признаках и на рисунке.`,
      );
    }
  } else if (
    closure &&
    seesZip(closure.value) &&
    !nodeIds.some((id) =>
      /^(zip_|cardigan_placket|front_placket|polo_placket|fly_zip|invisible_zip)/.test(id),
    )
  ) {
    // Категория без застёжки вовсе (свитер, лонгслив), а на снимке молния:
    // узлы молнии добавляются — иначе она осталась бы только рисунком, без
    // операции и без строки фурнитуры.
    const applicable = new Set(base.nodesFor(input.category).map((n) => n.id));
    if (applicable.has('zip_set_in')) {
      const after = Math.max(
        nodeIds.lastIndexOf('neck_topstitch_tape'),
        nodeIds.lastIndexOf('neck_rib_band'),
        nodeIds.lastIndexOf('neck_binding'),
      );
      const extra = [
        'zip_set_in',
        ...(applicable.has('zip_placket_topstitch') ? ['zip_placket_topstitch'] : []),
      ];
      nodeIds.splice(after + 1, 0, ...extra);
      for (const id of extra) added.push(id);
      notes.push(
        `На фото застёжка — молния (${closure.value}), а в типовом наборе категории ` +
          `застёжки нет. Добавлены втачивание разъёмной молнии и отстрочка планок; ` +
          `место операций в последовательности подтверждает технолог.`,
      );
    }
  }

  // --- 1c. Манжета и пояс по фото: рибана сплошная, отдельной детали нет ------
  //
  // Категория даёт манжету-риб и пояс-риб отдельными деталями. На вещи из
  // рубчика низ часто просто подшит, и взгляд это называет: «без отдельной
  // манжеты», «отдельный пояс не читается». Тогда узлы детали заменяются на
  // подгибку распошивом, а высоты манжеты и пояса уходят из табеля.
  const bands: [string, string, string, string][] = [
    ['cuff_type', 'cuff_rib', 'sleeve_hem_coverstitch', 'манжеты'],
    ['waistband_type', 'waistband_rib', 'hem_coverstitch', 'пояса'],
  ];
  for (const [key, from, to, what] of bands) {
    const seen = input.observations ? undefined : observed.get(key);
    const at = nodeIds.indexOf(from);
    if (!seen || at < 0 || seen.confidence === 'low' || !seesNoBand(seen.value)) continue;
    if (!base.nodesFor(input.category).some((n) => n.id === to)) continue;
    nodeIds[at] = to;
    substitutions.set(from, to);
    notes.push(
      `На фото нет отдельной детали ${what} (${seen.value}): узел заменён на подгибку ` +
        `распошивом, высота ${what} из табеля убрана. Подтвердите по образцу.`,
    );
  }

  // --- 1d. Горловина по фото: узкая окантовка вместо бейки-риб -----------------
  //
  // Категория даёт бейку-риб кольцом, и художник рисует её стойкой в 3 см.
  // На вещи из рубчика край горловины часто просто окантован узкой бейкой
  // (или лентой молнии), и взгляд это называет: «узкая бейка», «без
  // воротника», «V-образный вырез». Тогда узел заменяется на окантовку, а
  // высота бейки в табеле приводится к высоте окантовки (см. style-spec).
  const neck = input.observations ? undefined : observed.get('neckline_type');
  const neckAt = nodeIds.indexOf('neck_rib_band');
  if (neck && neckAt >= 0 && neck.confidence !== 'low' && seesNarrowNeck(neck.value)) {
    if (base.nodesFor(input.category).some((n) => n.id === 'neck_binding')) {
      nodeIds[neckAt] = 'neck_binding';
      substitutions.set('neck_rib_band', 'neck_binding');
      notes.push(
        `Горловина по фото — узкая окантовка, не бейка-стойка (${neck.value}): узел ` +
          `заменён на окантовку бейкой, высота бейки в табеле приведена к высоте окантовки. ` +
          `Подтвердите по образцу.`,
      );
    }
  }

  // --- 2. Сборка узлов --------------------------------------------------------
  const nodes = nodeIds.map((id) => buildNode(base.node(id), observed, input, base, notes));

  // --- 3. Технологическая последовательность ----------------------------------
  const sequence = buildSequence(
    defaults.tech_sequence,
    nodes,
    substitutions,
    dropped,
    base,
    added,
  );

  return { nodes, sequence, notes };
}

/**
 * Взгляд сказал, что отдельной манжеты или пояса нет: подгибка, «без
 * отдельной», «не читается». Просто «рибана» отдельной деталью не считается:
 * сплошной рубчик тоже рибана.
 */
export function seesNoBand(value: string): boolean {
  const v = value.toLowerCase();
  if (/подгиб|подшит/.test(v)) return true;
  return (
    /(без|нет|не читается|не видно|отсутств)/.test(v) && /(отдельн|манжет|пояс|деталь)/.test(v)
  );
}

/**
 * Взгляд назвал узкую окантовку, безворотниковую или V-образную горловину —
 * то, что бейкой-стойкой не рисуется. «Стойка», «воротник-стойка», «высокая
 * бейка» остаются бейкой.
 */
export function seesNarrowNeck(value: string): boolean {
  const v = value.toLowerCase();
  // «Невысокий» — не «высокий»: отрицание убирается до проверки.
  if (/стойк|mock|turtle/.test(v) || /высок/.test(v.replace(/невысок/g, ''))) return false;
  return /узк|окантов|без воротник|безворотник|v-образ|v-neck|уголк|binding|collarless/.test(v);
}

/** Взгляд назвал молнию, а не её отсутствие: «без молнии» — не молния. */
export function seesZip(value: string): boolean {
  const v = value.toLowerCase();
  return /молни|zip/.test(v) && !/(без|нет|отсутств|no |not )/.test(v);
}

function buildNode(
  node: ConstructionNode,
  observed: ReadonlyMap<string, VisibleElement>,
  input: Pick<ConstructionInput, 'machine_park'>,
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
  dropped: ReadonlySet<string> = new Set(),
  base: KnowledgeBase = defaultKb(),
  added: readonly string[] = [],
): TechSequenceStep[] {
  const byId = new Map(nodes.map((n) => [n.node_id, n]));

  // Операции добавленных узлов — из дефолтов той категории, где узел
  // типовой; встают после операций горловины. Нумерация ниже сплошная.
  const ops: TechOperation[] = [...operations];
  for (const id of added) {
    const op = techOperationFor(id, base);
    if (!op) continue;
    // Место — как у донора: после последней из операций, что у донора шли
    // перед этой и есть у нас; таких нет — перед первой из тех, что шли
    // после; донора нет вовсе — после операций горловины.
    const { before, after } = neighboursFor(id, base);
    let at = -1;
    for (let i = 0; i < ops.length; i++) {
      const n = ops[i]!.node_id;
      if (n && before.has(n)) at = i;
    }
    if (at < 0) {
      const next = ops.findIndex((o) => o.node_id && after.has(o.node_id));
      if (next >= 0) at = next - 1;
    }
    if (at < 0 && !after.size)
      at = ops.reduce((last, o, i) => (o.node_id && /^neck_/.test(o.node_id) ? i : last), -1);
    ops.splice(at + 1, 0, op);
  }

  return (
    ops
      // Операции убранных узлов уходят вместе с ними: обметать петли на
      // планке, которой нет, нельзя. Нумерация ниже сплошная.
      .filter((op) => !(op.node_id && dropped.has(op.node_id)))
      .map((op, i) => {
        const nodeId = op.node_id ? (substitutions.get(op.node_id) ?? op.node_id) : null;
        const node = nodeId ? byId.get(nodeId) : undefined;
        // Замена застёжки меняет и слова операции: «притачать планки»
        // для молнии — не то действие. Формулировка берётся у той категории,
        // где узел-замена типовой; место в последовательности остаётся.
        const swapped =
          op.node_id && nodeId && op.node_id !== nodeId ? techOperationFor(nodeId, base) : null;
        const text = swapped ?? op;
        return {
          step: i + 1,
          operation_ru: text.operation_ru,
          // Перевод едет вместе с операцией: снапшот, отправленный фабрике
          // полгода назад, обязан читаться так же, как читался тогда.
          ...(text.operation_en ? { operation_en: text.operation_en } : {}),
          ...(text.operation_zh ? { operation_zh: text.operation_zh } : {}),
          node_id: nodeId,
          specialty: text.specialty,
          machine: node?.machine ?? text.machine ?? 'manual',
          time_sec: text.time_sec,
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
      })
  );
}

/**
 * Один узел в собранном виде — для правки готового изделия.
 *
 * Сборка собирает набор узлов из категорийных дефолтов и наблюдений с фото.
 * Правка фразой («добавьте накладной карман») добавляет узел в УЖЕ собранное
 * изделие: фото его не показывало, дефолты его не содержали. Присутствие
 * такого узла — слово человека, и статус у него «указано вами».
 */
export function buildNodeValue(
  nodeId: string,
  input: Pick<ConstructionInput, 'machine_park'>,
  base: KnowledgeBase = defaultKb(),
  notes: string[] = [],
): ConstructionValue {
  const built = buildNode(base.node(nodeId), new Map(), input, base, notes);
  return {
    ...built,
    presence: userInput(true, 'user:revise', 'добавлено правкой изделия'),
  };
}

/**
 * Операция техпоследовательности для узла — из дефолтов той категории, где
 * узел типовой. Порядок операций из набора узлов не выводится, поэтому
 * операция для добавленного узла берётся готовой формулировкой, а встаёт
 * в конец: место в последовательности подтверждает технолог.
 */
export function techOperationFor(
  nodeId: string,
  base: KnowledgeBase = defaultKb(),
): TechOperation | null {
  for (const defaults of base.allCategoryDefaults()) {
    const op = defaults.tech_sequence.find((o) => o.node_id === nodeId);
    if (op) return op;
  }
  return null;
}

/** Узлы, чьи операции у категории-донора идут до и после операции этого узла. */
function neighboursFor(
  nodeId: string,
  base: KnowledgeBase,
): { before: Set<string>; after: Set<string> } {
  const before = new Set<string>();
  const after = new Set<string>();
  for (const defaults of base.allCategoryDefaults()) {
    const at = defaults.tech_sequence.findIndex((o) => o.node_id === nodeId);
    if (at < 0) continue;
    for (const o of defaults.tech_sequence.slice(0, at)) if (o.node_id) before.add(o.node_id);
    for (const o of defaults.tech_sequence.slice(at + 1)) if (o.node_id) after.add(o.node_id);
    break;
  }
  return { before, after };
}

/** Сколько узлов требуют подтверждения по образцу. */
export function countConstructionAssumptions(nodes: readonly ConstructionValue[]): number {
  return nodes.filter((n) => n.presence.confidence === 'assumption').length;
}
