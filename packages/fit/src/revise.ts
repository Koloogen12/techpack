import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { SeamsterError } from '@seamster/core';
import {
  buildBomLine,
  buildMeasurements,
  buildNodeValue,
  techOperationFor,
  type PomInput,
} from '@seamster/assembly';
import {
  CATEGORY_LABEL_RU,
  kb as defaultKb,
  type Category,
  type KnowledgeBase,
} from '@seamster/kb';
import { parseStyleSpec, specFingerprint, type StyleSpec } from '@seamster/stylespec';
import { createClient } from '@seamster/vision';
import { editMeasurement } from './edit.js';

/**
 * Правка изделия фразой.
 *
 * Человек пишет «убери капюшон» или «рукав до локтя», и меняется не картинка,
 * а СПЕЦИФИКАЦИЯ: узлы, табель, материалы, дизайн-признаки. Рисунок потом
 * перерисовывается по новой спецификации — тем же путём, что при сборке.
 * Конкурент правит картинку промптом и оставляет таблицы прежними; у нас
 * таблицы первичны, и картинка обязана им следовать, а не наоборот.
 *
 * Модель здесь переводит фразу в ОПЕРАЦИИ над данными по закрытым спискам:
 * узлы — из реестра для этой категории, точки — из табеля, признаки — по
 * зонам. Ничего вне списков она сделать не может, и то, что не выражается
 * операциями («сделай красным», «замени ткань»), возвращается словами:
 * человек видит, что именно не понято, до того как что-то изменилось.
 *
 * Применение — чистая функция без сети: план можно показать, проверить
 * тестом и применить к спеке столько раз, сколько нужно.
 */

export const REVISE_PROMPT_VERSION = 'r1';

export const REVISION_OPS = [
  'remove_node',
  'add_node',
  'set_measurement',
  'add_feature',
  'remove_feature',
] as const;
export type RevisionOpKind = (typeof REVISION_OPS)[number];

/**
 * Операция — плоский объект, а не размеченное объединение: structured
 * output и прокси-режим с JSON-схемой в промпте одинаково хорошо держат
 * плоскую форму, а anyOf через прокси доезжал не всегда.
 */
export const RevisionOpSchema = z.object({
  op: z.enum(REVISION_OPS),
  /** Для remove_node / add_node — идентификатор узла из списка. */
  node_id: z.string().nullable(),
  /** Для set_measurement — код точки табеля. */
  code: z.string().nullable(),
  /** Новое значение, см. Пусто — задан сдвиг. */
  value_cm: z.number().nullable(),
  /** Сдвиг от текущего значения, см; отрицательный — уменьшить. */
  delta_cm: z.number().nullable(),
  /** Для признаков — зона по списку. */
  zone: z.string().nullable(),
  /** Признак по-русски (в документ) и по-английски (художнику). */
  ru: z.string().nullable(),
  en: z.string().nullable(),
  /** Для remove_feature — фрагмент текста признака, который убирается. */
  match: z.string().nullable(),
  /** Зачем операция — коротко, по-русски. */
  why_ru: z.string(),
});

export const RevisionPlanSchema = z.object({
  ops: z.array(RevisionOpSchema),
  /** Одной фразой по-русски: что изменится в изделии. */
  summary_ru: z.string(),
  /**
   * Те же изменения по-английски, коротко, для задания художнику:
   * «remove the hood», «sleeves end above the elbow».
   */
  changes_en: z.array(z.string()),
  /** Что из просьбы выразить нельзя или не понято. Пусто — всё понято. */
  unclear_ru: z.string().nullable(),
});

export type RevisionOp = z.infer<typeof RevisionOpSchema>;
export type RevisionPlan = z.infer<typeof RevisionPlanSchema>;

export function defaultReviseModel(): string {
  return process.env.SEAMSTER_REVISE_MODEL ?? 'claude-sonnet-5';
}

// ------------------------------------------------------------- контекст

const ZONES = [
  'neckline',
  'collar',
  'shoulder',
  'sleeve',
  'bodice',
  'waist',
  'skirt',
  'hem',
  'back',
  'closure',
  'pocket',
  'trim',
  'other',
] as const;

/**
 * Что модель знает об изделии: узлы, которые есть; узлы, которые можно
 * добавить; точки табеля с текущими значениями; признаки. Всё — закрытыми
 * списками с идентификаторами, потому что операции ссылаются на них.
 */
export function revisionContext(spec: StyleSpec, base: KnowledgeBase = defaultKb()): string {
  const category = spec.style.category as Category;
  const present = spec.construction?.nodes ?? [];
  const presentIds = new Set(present.map((n) => n.node_id));
  const addable = base.nodesFor(category).filter((n) => !presentIds.has(n.id));
  const template = base.pomTemplate(category, spec.base.fabric_kind);
  const composed = template.points.filter((p) => p.composed_of?.length);
  const byCode = new Map(spec.measurements.points.map((p) => [p.code, p]));

  const lines = [
    `Garment: ${CATEGORY_LABEL_RU[category]} (${category}), fabric: ${spec.base.fabric_kind}, fit: ${spec.base.fit_intent}, base size RU ${spec.base.base_size_ru}, height ${spec.base.base_height_cm} cm.`,
    '',
    'CONSTRUCTION NODES PRESENT (id — name; zone):',
    ...present.map((n) => `  ${n.node_id} — ${n.label_ru} / ${n.label_en ?? ''}; ${n.zone}`),
    '',
    'NODES THAT CAN BE ADDED for this garment (id — name; zone):',
    ...(addable.length
      ? addable.map((n) => `  ${n.id} — ${n.label_ru} / ${n.label_en}; ${n.zone}`)
      : ['  (none)']),
    '',
    'MEASUREMENT POINTS (code — name: current value cm):',
    ...spec.measurements.points.map(
      (p) => `  ${p.code} — ${p.name_ru} / ${p.name_en}: ${p.base.value}`,
    ),
    ...(composed.length
      ? [
          '',
          'COMPOSED POINTS are identities and cannot be set directly — set their parts instead:',
          ...composed.map(
            (p) =>
              `  ${p.code} = ${p.composed_of!.map((c) => `${c.factor}×${c.code}`).join(' + ')}` +
              (byCode.has(p.code) ? ` (now ${byCode.get(p.code)!.base.value} cm)` : ''),
          ),
        ]
      : []),
    '',
    'DESIGN FEATURES on record (zone: ru / en):',
    ...((spec.design?.features ?? []).length
      ? spec.design!.features.map((f) => `  ${f.zone}: ${f.ru} / ${f.en}`)
      : ['  (none)']),
    '',
    `FEATURE ZONES: ${ZONES.join(', ')}.`,
  ];
  return lines.join('\n');
}

function systemPrompt(): string {
  return [
    "You translate a garment designer's sentence into structured operations over a technical specification.",
    'You are given closed lists: construction nodes present, nodes that can be added, measurement points with current values, design features.',
    'Rules:',
    '- Use ONLY identifiers from the lists. Never invent node ids or point codes.',
    '- "remove X": remove_node for every node that belongs to X (a hood is hood_* nodes: set-in, centre seam, drawcord casing, eyelets). A pocket is its pocket nodes and their bartacks.',
    '- "add X": add_node from the addable list. Add the supporting nodes too (a hood needs its centre seam and set-in; a drawcord needs its eyelets).',
    '- Length and width changes are set_measurement. Composed points cannot be set: change their parts so the identity gives the wanted value. Sleeve length from shoulder is the composed point; to shorten sleeves, reduce the sleeve length from centre back by the same amount.',
    '- Typical sleeve length from shoulder for an adult: long ≈ 58–64 cm, three-quarter ≈ 40–44 cm, short ≈ 20–24 cm, cap ≈ 10–12 cm.',
    '- When sleeves become short, ribbed cuffs make no sense: remove cuff_rib and add the plain sleeve hem node if it is in the addable list.',
    '- Shape words with no node or point (puff sleeve, princess seams, raglan, cropped look) are add_feature with a zone, ru and en; removing such a look is remove_feature with a match fragment from the features on record.',
    '- Colour, fabric, print, price, size range, brand details are NOT expressible here: leave ops empty for that part and explain in unclear_ru (in Russian).',
    '- Do nothing the sentence did not ask. If the sentence is ambiguous, prefer the smaller change and say what you assumed in why_ru.',
    '- summary_ru: one Russian sentence about what changes in the garment. changes_en: the same changes as short imperative English phrases for the artist who redraws the flat sketch, one per change (e.g. "remove the hood", "sleeves end above the elbow"). Empty when nothing changes.',
    '- why_ru is short Russian.',
  ].join('\n');
}

// ---------------------------------------------------------- интерпретация

export interface InterpretOptions {
  spec: StyleSpec;
  text: string;
  base?: KnowledgeBase;
  client?: Anthropic;
  model?: string;
  /** Папка кэша: та же фраза к той же спеке не зовёт модель второй раз. */
  cacheDir?: string;
}

export interface InterpretResult {
  plan: RevisionPlan;
  fromCache: boolean;
  ms: number;
}

/** Фраза приводится к виду, при котором «Убери капюшон» и «убери капюшон.» — одна просьба. */
export function normalizeRequest(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!]+$/, '')
    .toLowerCase();
}

export async function interpretRevision(options: InterpretOptions): Promise<InterpretResult> {
  const base = options.base ?? defaultKb();
  const model = options.model ?? defaultReviseModel();
  const text = options.text.trim();
  if (text.length < 3) {
    throw new SeamsterError('SPEC_INVALID', 'пустая просьба', {
      userMessage: 'Напишите, что изменить в изделии.',
      userAction: 'Например: «убери капюшон» или «рукав до локтя»',
    });
  }
  if (text.length > 400) {
    throw new SeamsterError('SPEC_INVALID', 'слишком длинная просьба', {
      userMessage: 'Просьба слишком длинная.',
      userAction: 'Опишите одно-два изменения, не больше 400 знаков',
    });
  }

  const key = createHash('sha256')
    .update(
      [specFingerprint(options.spec), normalizeRequest(text), REVISE_PROMPT_VERSION, model].join(
        '|',
      ),
    )
    .digest('hex')
    .slice(0, 32);
  const cachePath = options.cacheDir
    ? join(options.cacheDir, key.slice(0, 2), `${key}.json`)
    : null;
  if (cachePath && existsSync(cachePath)) {
    try {
      const plan = RevisionPlanSchema.parse(JSON.parse(readFileSync(cachePath, 'utf8')));
      return { plan, fromCache: true, ms: 0 };
    } catch {
      /* битый файл кэша — спрашиваем заново */
    }
  }

  const client = options.client ?? createClient();
  const context = revisionContext(options.spec, base);
  const user = `${context}\n\nDESIGNER'S REQUEST (Russian or English):\n"${text}"`;
  const startedAt = performance.now();
  let plan: RevisionPlan;

  if (process.env.SEAMSTER_VISION_BASE_URL) {
    // Прокси-режим: structured output через прокси не доезжает, схема
    // уходит в промпт, ответ разбирается тем же zod.
    const schema = JSON.stringify(z.toJSONSchema(RevisionPlanSchema));
    const response = await client.messages.create({
      model,
      max_tokens: 4000,
      system: `${systemPrompt()}\n\nAnswer with a SINGLE JSON object matching this JSON schema, no prose, no markdown fences:\n${schema}`,
      messages: [{ role: 'user', content: user }],
    });
    const raw = response.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('')
      .trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < start) {
      throw new SeamsterError('VISION_SCHEMA_MISMATCH', 'ответ модели без JSON', {
        userMessage: 'Не удалось разобрать просьбу.',
        userAction: 'Сформулируйте иначе — попытка бесплатная',
        details: { model },
      });
    }
    plan = RevisionPlanSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } else {
    const response = await client.messages.parse({
      model,
      max_tokens: 4000,
      system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      output_config: { format: zodOutputFormat(RevisionPlanSchema) },
    });
    if (!response.parsed_output) {
      throw new SeamsterError('VISION_SCHEMA_MISMATCH', 'план правки не сошёлся со схемой', {
        userMessage: 'Не удалось разобрать просьбу.',
        userAction: 'Сформулируйте иначе — попытка бесплатная',
        details: { model, version: REVISE_PROMPT_VERSION },
      });
    }
    plan = response.parsed_output;
  }
  const ms = Math.round(performance.now() - startedAt);

  if (cachePath) {
    mkdirSync(join(options.cacheDir!, key.slice(0, 2)), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(plan));
  }
  return { plan, fromCache: false, ms };
}

// ------------------------------------------------------------- применение

export interface ApplyRevisionResult {
  spec: StyleSpec;
  /** Что изменилось — по-русски, строками для человека. */
  changed_ru: string[];
  /** Что не применилось и почему. */
  rejected_ru: string[];
  /** Затронутые разделы кабинета — для пометок «проверьте». */
  sections: ('pom' | 'nodes' | 'bom' | 'flats')[];
}

/**
 * Фурнитура, которая существует только ради узла.
 *
 * Спецификация материалов собирается списком по категории и узлов не знает.
 * Но шнур без кулиски и люверсы без капюшона — строки, за которые фабрика
 * закупит лишнее. Связь узел → артикул явная и короткая; всё, что здесь не
 * перечислено, при удалении узла остаётся в таблице, и это правильно:
 * нитки и ярлыки нужны любому изделию.
 */
const MATERIAL_BY_NODE: Record<string, readonly string[]> = {
  hood_drawcord_casing: ['drawcord_flat', 'cord_tip'],
  hood_eyelets: ['eyelet_metal'],
  zip_set_in: ['zipper_separating', 'zipper_separating_8'],
  invisible_zip_back: ['zipper_invisible'],
  fly_zip: ['zipper_trouser'],
  placket_buttonholes: ['button_polo', 'button_shirt', 'button_cardigan', 'button_coat_36l'],
  button_sew: [
    'button_polo',
    'button_shirt',
    'button_cardigan',
    'button_coat_36l',
    'button_trouser',
  ],
  placket_snap: ['snap_button_15'],
  cuff_elastic_casing: ['elastic_band_25'],
};

const SOURCE = 'user:revise';

export function applyRevision(
  spec: StyleSpec,
  plan: RevisionPlan,
  base: KnowledgeBase = defaultKb(),
): ApplyRevisionResult {
  const changed: string[] = [];
  const rejected: string[] = [];
  const sections = new Set<ApplyRevisionResult['sections'][number]>();
  const category = spec.style.category as Category;

  let nodes = [...(spec.construction?.nodes ?? [])];
  let sequence = [...(spec.construction?.sequence ?? [])];
  let lines = [...(spec.bom?.lines ?? [])];
  let features = [...(spec.design?.features ?? [])];
  let working: StyleSpec = spec;

  // --- 1. Узлы -----------------------------------------------------------
  const removedNodes: string[] = [];
  const addedNodes: string[] = [];
  for (const op of plan.ops) {
    if (op.op === 'remove_node') {
      const id = op.node_id ?? '';
      const node = nodes.find((n) => n.node_id === id);
      if (!node) {
        rejected.push(`узла «${id}» в изделии нет`);
        continue;
      }
      nodes = nodes.filter((n) => n.node_id !== id);
      sequence = sequence.filter((s) => s.node_id !== id);
      removedNodes.push(node.label_ru);
      const materials = MATERIAL_BY_NODE[id] ?? [];
      const gone = lines.filter((l) => materials.includes(l.material_id));
      if (gone.length) {
        lines = lines.filter((l) => !materials.includes(l.material_id));
        changed.push(`Материалы: убрано — ${gone.map((l) => l.name_ru).join(', ')}`);
        sections.add('bom');
      }
    }
    if (op.op === 'add_node') {
      const id = op.node_id ?? '';
      if (nodes.some((n) => n.node_id === id)) {
        rejected.push(`узел «${id}» уже есть в изделии`);
        continue;
      }
      if (!base.nodesFor(category).some((n) => n.id === id)) {
        rejected.push(`узел «${id}» не применяется к этой категории`);
        continue;
      }
      const park = spec.construction?.machine_park_profile;
      const value = buildNodeValue(id, park ? { machine_park: park } : {}, base);
      nodes.push(value);
      addedNodes.push(value.label_ru);
      const op2 = techOperationFor(id, base);
      const step = sequence.length + 1;
      sequence.push(
        op2
          ? {
              step,
              operation_ru: op2.operation_ru,
              ...(op2.operation_en ? { operation_en: op2.operation_en } : {}),
              ...(op2.operation_zh ? { operation_zh: op2.operation_zh } : {}),
              node_id: id,
              specialty: op2.specialty,
              machine: value.machine,
              time_sec: op2.time_sec,
            }
          : {
              step,
              operation_ru: `Выполнить узел «${value.label_ru}»`,
              ...(value.label_en ? { operation_en: `Make: ${value.label_en}` } : {}),
              node_id: id,
              specialty: value.specialty,
              machine: value.machine,
              time_sec: null,
            },
      );
      // Фурнитура нового узла — теми же строками, что при сборке.
      const wanted = (MATERIAL_BY_NODE[id] ?? []).filter(
        (m) => !lines.some((l) => l.material_id === m),
      );
      const bomInput = {
        category,
        fabric_kind: spec.base.fabric_kind,
        ...(spec.bom?.colorways ? { colorways: spec.bom.colorways } : {}),
        ...(spec.bom?.batch_qty ? { quantity: spec.bom.batch_qty } : {}),
      };
      const added: string[] = [];
      for (const m of wanted) {
        let material;
        try {
          material = base.material(m);
        } catch {
          continue;
        }
        if (!material.applications.includes(category)) continue;
        const code = `H${String(lines.filter((l) => l.role === 'hardware').length + 1).padStart(2, '0')}`;
        lines.push(buildBomLine(m, 'hardware', code, bomInput, base));
        added.push(material.name_ru);
      }
      if (added.length) {
        changed.push(`Материалы: добавлено — ${added.join(', ')}`);
        sections.add('bom');
      }
    }
  }
  if (removedNodes.length) {
    changed.push(`Конструкция: убрано — ${removedNodes.join(', ')}`);
    sections.add('nodes');
    sections.add('flats');
  }
  if (addedNodes.length) {
    changed.push(`Конструкция: добавлено — ${addedNodes.join(', ')}`);
    sections.add('nodes');
    sections.add('flats');
  }
  // Нумерация операций сплошная: фабрика читает её по порядку.
  sequence = sequence.map((s, i) => ({ ...s, step: i + 1 }));

  // --- 2. Точки табеля, привязанные к узлам -------------------------------
  const template = base.pomTemplate(category, spec.base.fabric_kind);
  const presentIds = new Set(nodes.map((n) => n.node_id));
  const needsNode = new Map(
    template.points.filter((p) => p.requires_node).map((p) => [p.code, p.requires_node!]),
  );
  let points = [...spec.measurements.points];
  const dropped = points.filter((p) => {
    const node = needsNode.get(p.code);
    return node !== undefined && !presentIds.has(node);
  });
  if (dropped.length) {
    const keptCodes = new Set(points.filter((p) => !dropped.includes(p)).map((p) => p.code));
    const composedOf = new Map(
      template.points
        .filter((p) => p.composed_of?.length)
        .map((p) => [p.code, p.composed_of!.map((c) => c.code)]),
    );
    points = points.filter((p) => {
      if (dropped.includes(p)) return false;
      const parts = composedOf.get(p.code);
      return !parts || parts.every((c) => keptCodes.has(c));
    });
    changed.push(`Табель: убрано — ${dropped.map((p) => `${p.code} ${p.name_ru}`).join(', ')}`);
    sections.add('pom');
  }
  const missing = template.points.filter(
    (p) =>
      !points.some((x) => x.code === p.code) &&
      p.requires_node &&
      presentIds.has(p.requires_node) &&
      (!p.composed_of?.length || p.composed_of.every((c) => points.some((x) => x.code === c.code))),
  );
  if (missing.length) {
    // Значения новых точек — типовые из табеля: фото добавленный узел не
    // показывало, и честный статус здесь «типовое, подтвердить».
    const input: PomInput = {
      category,
      gender: spec.base.gender,
      base_size_ru: spec.base.base_size_ru,
      base_height_cm: spec.base.base_height_cm,
      fit_intent: spec.base.fit_intent,
      fabric_kind: spec.base.fabric_kind,
      size_range: [...spec.base.size_range],
    };
    const rebuilt = buildMeasurements(input, base).measurements.points;
    const added: string[] = [];
    for (const m of missing) {
      const p = rebuilt.find((x) => x.code === m.code);
      if (!p) continue;
      points.push({
        ...p,
        base: { ...p.base, note: 'добавлено правкой изделия — типовое значение, подтвердить' },
      });
      added.push(`${p.code} ${p.name_ru}`);
    }
    if (added.length) {
      changed.push(`Табель: добавлено — ${added.join(', ')}`);
      sections.add('pom');
    }
  }
  // Порядок точек — как в шаблоне: таблица читается сверху вниз по коду.
  const order = new Map(template.points.map((p, i) => [p.code, i]));
  points.sort((a, b) => (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999));

  // --- 3. Признаки --------------------------------------------------------
  for (const op of plan.ops) {
    if (op.op === 'add_feature') {
      const zone = ZONES.find((z) => z === op.zone) ?? 'other';
      const ru = (op.ru ?? '').trim();
      const en = (op.en ?? '').trim();
      if (!ru || !en) {
        rejected.push('признак без формулировки не добавлен');
        continue;
      }
      if (features.some((f) => f.en.toLowerCase() === en.toLowerCase())) continue;
      features.push({ zone, ru, en, certainty: 'high', confidence: 'user_input', source: SOURCE });
      changed.push(`Дизайн: добавлено — ${ru}`);
      sections.add('flats');
    }
    if (op.op === 'remove_feature') {
      const needle = (op.match ?? '').trim().toLowerCase();
      if (!needle) continue;
      const gone = features.filter(
        (f) => f.en.toLowerCase().includes(needle) || f.ru.toLowerCase().includes(needle),
      );
      if (!gone.length) {
        rejected.push(`признака «${op.match}» в документе нет`);
        continue;
      }
      features = features.filter((f) => !gone.includes(f));
      changed.push(`Дизайн: убрано — ${gone.map((f) => f.ru).join(', ')}`);
      sections.add('flats');
    }
  }

  // --- 4. Сборка промежуточной спеки ---------------------------------------
  working = withAssumptionCount({
    ...spec,
    measurements: { ...spec.measurements, points },
    ...(spec.construction
      ? {
          construction: { ...spec.construction, nodes, sequence },
        }
      : {}),
    ...(features.length ? { design: { features } } : { design: undefined }),
    ...(spec.bom ? { bom: { ...spec.bom, lines } } : {}),
  });

  // --- 5. Замеры — через ту же правку, что и таблица кабинета ---------------
  for (const op of plan.ops) {
    if (op.op !== 'set_measurement') continue;
    const code = op.code ?? '';
    const current = working.measurements.points.find((p) => p.code === code);
    if (!current) {
      rejected.push(`точки ${code} в табеле нет`);
      continue;
    }
    const target =
      op.value_cm !== null
        ? op.value_cm
        : op.delta_cm !== null
          ? current.base.value + op.delta_cm
          : null;
    if (target === null) {
      rejected.push(`для ${code} не задано ни значение, ни сдвиг`);
      continue;
    }
    const result = editMeasurement(working, code, target, base);
    if (result.rejected) {
      rejected.push(`${code}: ${result.rejected}`);
      continue;
    }
    working = result.spec;
    for (const c of result.changed) {
      const p = working.measurements.points.find((x) => x.code === c.code);
      changed.push(`Табель: ${c.code} ${p?.name_ru ?? ''} — ${c.from_cm} → ${c.to_cm} см`);
    }
    sections.add('pom');
    sections.add('flats');
  }

  return {
    spec: working,
    changed_ru: changed,
    rejected_ru: rejected,
    sections: [...sections],
  };
}

/** Счётчик предположений — проекция данных; схема проверит, что он сошёлся. */
function withAssumptionCount(
  draft: Omit<StyleSpec, 'design'> & { design?: StyleSpec['design'] },
): StyleSpec {
  const { design, ...rest } = draft;
  const count =
    rest.measurements.points.filter(
      (p) => p.base.confidence === 'assumption' || p.tolerance.confidence === 'assumption',
    ).length +
    (rest.construction?.nodes.filter((n) => n.presence.confidence === 'assumption').length ?? 0) +
    (rest.bom?.lines.filter(
      (l) => l.composition.confidence === 'assumption' || l.gsm?.confidence === 'assumption',
    ).length ?? 0);
  return parseStyleSpec({
    ...rest,
    ...(design ? { design } : {}),
    meta: { ...rest.meta, assumptions_count: count },
  });
}
