import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SpecFormError } from '@specform/core';
import type { z } from 'zod';
import {
  CareSymbolsFileSchema,
  CategoryDefaultsFileSchema,
  ConstructionNodesFileSchema,
  ConsumptionFileSchema,
  EaseFileSchema,
  LabelingFileSchema,
  MachineParkFileSchema,
  MaterialsFileSchema,
  SeamCodesFileSchema,
  StitchCodesFileSchema,
  VisibilityMapFileSchema,
  GradingFileSchema,
  PomTemplateFileSchema,
  SizeChartsFileSchema,
  ToleranceClassesFileSchema,
  type CareProfile,
  type CareSymbolsFile,
  type Category,
  type CategoryDefaultsFile,
  type ConstructionNode,
  type ConstructionNodesFile,
  type ConsumptionFile,
  type ConsumptionFormula,
  type EaseEntry,
  type EaseFile,
  type FabricKind,
  type FitIntent,
  type Gender,
  type GradingFile,
  type GradingRule,
  type LabelingFile,
  type LabelRequisite,
  type MachineParkFile,
  type MachineParkProfile,
  type MachineType,
  type Material,
  type MaterialsFile,
  type PomTemplateFile,
  type SeamCode,
  type SeamCodesFile,
  type StitchCode,
  type StitchCodesFile,
  type SizeChart,
  type SizeChartsFile,
  type ToleranceClass,
  type ToleranceClassEntry,
  type ToleranceComparison,
  type ToleranceProfile,
  type ToleranceProfileId,
  type QcRule,
  type ToleranceClassesFile,
  type VisibilityMapFile,
} from './schemas/index.js';

const DATA_DIR = new URL('../data/', import.meta.url).pathname;

/** Посадки от прилегающей к свободной. Порядок задаёт направление отката. */
const FIT_ORDER: readonly FitIntent[] = ['fitted', 'semi_fitted', 'loose', 'oversize'];

function loadFile<T>(relativePath: string, schema: z.ZodType<T>): T {
  const path = join(DATA_DIR, relativePath);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new SpecFormError('KB_MISSING', `справочник не найден: ${relativePath}`, {
      userMessage: 'Внутренняя ошибка: не удалось загрузить справочник.',
      userAction: 'Повторить генерацию. Если повторяется — напишите нам, это на нашей стороне.',
      details: { path: relativePath },
      cause,
    });
  }

  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    // Справочник с ошибкой не грузится молча: битые данные дороже упавшего процесса.
    throw new SpecFormError('KB_INVALID', `справочник ${relativePath} не прошёл валидацию`, {
      userMessage: 'Внутренняя ошибка: справочник повреждён.',
      userAction: 'Повторить генерацию. Если повторяется — напишите нам, это на нашей стороне.',
      details: { path: relativePath, issues: JSON.stringify(parsed.error.issues, null, 2) },
    });
  }
  return parsed.data;
}

export interface EaseLookup {
  readonly entry: EaseEntry;
  /**
   * Заполнено, если для запрошенной посадки данных нет и движок откатился
   * к соседней. Вызывающий обязан объяснить это пользователю, а не молчать.
   */
  readonly fallbackFrom?: FitIntent;
}

/**
 * Справочники в памяти.
 *
 * Грузятся один раз на процесс: файлов немного, объём мал, а перечитывание
 * на каждый запрос дало бы разные данные внутри одной генерации.
 */
export class KnowledgeBase {
  private constructor(
    private readonly tolerances: ToleranceClassesFile,
    private readonly sizes: SizeChartsFile,
    private readonly ease: EaseFile,
    private readonly grading: GradingFile,
    private readonly pomTemplates: ReadonlyMap<Category, PomTemplateFile>,
    private readonly categoryDefaults: ReadonlyMap<Category, CategoryDefaultsFile>,
    private readonly stitches: StitchCodesFile,
    private readonly seams: SeamCodesFile,
    private readonly construction: ConstructionNodesFile,
    private readonly machinePark: MachineParkFile,
    private readonly materialsFile: MaterialsFile,
    private readonly consumption: ConsumptionFile,
    private readonly care: CareSymbolsFile,
    private readonly labeling: LabelingFile,
    private readonly visibility: VisibilityMapFile,
  ) {}

  static load(): KnowledgeBase {
    const pom = new Map<Category, PomTemplateFile>();
    const defaults = new Map<Category, CategoryDefaultsFile>();
    // Категории добавляются по мере готовности шаблонов; гейт вне MVP —
    // в мастере, а не здесь: отсутствующий шаблон обязан падать явно.
    for (const category of ['tshirt', 'longsleeve', 'sweatshirt', 'hoodie'] as const) {
      pom.set(category, loadFile(`pom_templates/${category}.json`, PomTemplateFileSchema));
      defaults.set(
        category,
        loadFile(`category_defaults/${category}.json`, CategoryDefaultsFileSchema),
      );
    }

    return new KnowledgeBase(
      loadFile('tolerance_classes.json', ToleranceClassesFileSchema),
      loadFile('size_charts_ru.json', SizeChartsFileSchema),
      loadFile('ease_defaults.json', EaseFileSchema),
      loadFile('grading_increments.json', GradingFileSchema),
      pom,
      defaults,
      loadFile('stitch_codes.json', StitchCodesFileSchema),
      loadFile('seam_codes.json', SeamCodesFileSchema),
      loadFile('construction_nodes.json', ConstructionNodesFileSchema),
      loadFile('machine_park_profiles.json', MachineParkFileSchema),
      loadFile('materials.json', MaterialsFileSchema),
      loadFile('consumption_formulas.json', ConsumptionFileSchema),
      loadFile('care_symbols.json', CareSymbolsFileSchema),
      loadFile('labeling_requirements.json', LabelingFileSchema),
      loadFile('visibility_map.json', VisibilityMapFileSchema),
    );
  }

  /** Категории, для которых есть шаблон точек измерения. */
  supportedCategories(): readonly Category[] {
    return [...this.pomTemplates.keys()];
  }

  toleranceClass(name: ToleranceClass): ToleranceClassEntry {
    const found = this.tolerances.classes.find((c) => c.class === name);
    if (!found) throw new Error(`неизвестный класс допуска: ${name}`);
    return found;
  }

  /**
   * Допуск по умолчанию для класса точки, ±см.
   *
   * Профиль `premium` жёстче ГОСТ. Это выбор бренда, а не «настройка качества»:
   * на тех же машинах и том же полотне ужесточение допуска не улучшает пошив,
   * а увеличивает долю изделий, не прошедших приёмку.
   */
  toleranceFor(
    name: ToleranceClass,
    fabric: FabricKind,
    profile: ToleranceProfileId = 'gost',
  ): number {
    const cls = this.toleranceClass(name);
    const base = fabric === 'knit' ? cls.knit.default : cls.woven.default;
    const override = this.toleranceProfile(profile).overrides[name];
    return override ?? base;
  }

  toleranceProfile(id: ToleranceProfileId): ToleranceProfile {
    const found = this.tolerances.profiles.find((p) => p.id === id);
    if (!found) throw new Error(`неизвестный профиль допусков: ${id}`);
    return found;
  }

  /** Чужие наборы допусков — только для сравнения в документе. */
  toleranceComparisons(): readonly ToleranceComparison[] {
    return this.tolerances.comparison_sets;
  }

  /** Правила приёмки, которые поточечный допуск не выражает. */
  qcRules(): readonly QcRule[] {
    return this.tolerances.qc_rules;
  }

  sizeChart(gender: Gender): SizeChart {
    const found = this.sizes.charts.find((c) => c.gender === gender);
    if (!found) throw new Error(`нет размерной сетки для: ${gender}`);
    return found;
  }

  /** Обхваты тела по российскому размеру. */
  bodyMeasurements(gender: Gender, ru: number) {
    const chart = this.sizeChart(gender);
    const row = chart.rows.find((r) => r.ru === ru);
    if (!row) {
      const available = chart.rows.map((r) => r.ru).join(', ');
      throw new SpecFormError('SPEC_INVALID', `размер ${ru} отсутствует в сетке ${gender}`, {
        userMessage: `Размера ${ru} нет в нашей размерной сетке.`,
        userAction: `Выберите размер из доступных: ${available}`,
        details: { gender, ru, available },
      });
    }
    return row;
  }

  /**
   * Прибавка на свободу облегания.
   *
   * Если для запрошенной посадки данных нет (например, прилегающее худи —
   * в базе знаний помечено как нетиповое), откатывается к ближайшей более
   * свободной и сообщает об этом через fallbackFrom.
   */
  easeFor(category: Category, fit: FitIntent, fabric: FabricKind): EaseLookup {
    const exact = this.ease.entries.find(
      (e) => e.category === category && e.fit === fit && e.fabric === fabric,
    );
    if (exact) return { entry: exact };

    const startIndex = FIT_ORDER.indexOf(fit);
    for (const candidate of FIT_ORDER.slice(startIndex + 1)) {
      const looser = this.ease.entries.find(
        (e) => e.category === category && e.fit === candidate && e.fabric === fabric,
      );
      if (looser) return { entry: looser, fallbackFrom: fit };
    }

    throw new SpecFormError('KB_MISSING', `нет прибавки для ${category}/${fit}/${fabric}`, {
      userMessage: 'Для этого сочетания категории и посадки у нас пока нет типовых значений.',
      userAction: 'Выберите другую посадку или напишите нам — добавим.',
      details: { category, fit, fabric },
    });
  }

  /** Все правила приращений — для проверок, которые смотрят на набор целиком. */
  gradingRules(): readonly GradingRule[] {
    return this.grading.rules;
  }

  gradingRule(key: string): GradingRule {
    const found = this.grading.rules.find((r) => r.key === key);
    if (!found) throw new Error(`неизвестное правило градации: ${key}`);
    return found;
  }

  /** Межразмерный шаг по обхвату груди, см. */
  chestStep(): number {
    return this.grading.chest_step;
  }

  pomTemplate(category: Category): PomTemplateFile {
    const found = this.pomTemplates.get(category);
    if (!found) {
      throw new SpecFormError('CATEGORY_UNSUPPORTED', `нет шаблона POM для ${category}`, {
        userMessage: 'Для этой категории мы пока не делаем техпаки.',
        userAction: 'Выберите категорию из доступных или запишитесь в лист ожидания',
        details: { category, supported: this.supportedCategories().join(', ') },
      });
    }
    return found;
  }

  // ---------------------------------------------------------------- конструкция

  categoryDefaultsFor(category: Category): CategoryDefaultsFile {
    const found = this.categoryDefaults.get(category);
    if (!found) {
      throw new SpecFormError('CATEGORY_UNSUPPORTED', `нет дефолтов для ${category}`, {
        userMessage: 'Для этой категории мы пока не делаем техпаки.',
        userAction: 'Выберите категорию из доступных или запишитесь в лист ожидания',
        details: { category, supported: [...this.categoryDefaults.keys()].join(', ') },
      });
    }
    return found;
  }

  node(id: string): ConstructionNode {
    const found = this.construction.nodes.find((n) => n.id === id);
    if (!found) throw new Error(`неизвестный узел обработки: ${id}`);
    return found;
  }

  nodesFor(category: Category): ConstructionNode[] {
    return this.construction.nodes.filter((n) => n.applies_to.includes(category));
  }

  stitch(code: string): StitchCode {
    const found = this.stitches.stitches.find((s) => s.code === code);
    if (!found) throw new Error(`неизвестный код стежка: ${code}`);
    return found;
  }

  seam(code: string): SeamCode {
    const found = this.seams.seams.find((s) => s.code === code);
    if (!found) throw new Error(`неизвестный код шва: ${code}`);
    return found;
  }

  machineParkProfile(id?: string): MachineParkProfile {
    const key = id ?? this.machinePark.default_profile;
    const found = this.machinePark.profiles.find((p) => p.id === key);
    if (!found) throw new Error(`неизвестный профиль парка машин: ${key}`);
    return found;
  }

  /**
   * Machine-park check (дифференциатор R6).
   *
   * Фабрика читает техпак через свой парк машин: написано 406 — нужна
   * распошивалка, замена на 301 на трикотаже даёт брак. Поэтому узел вне
   * парка возвращается вместе с готовой заменой, а не просто флагом.
   */
  checkMachinePark(
    node: ConstructionNode,
    profileId?: string,
  ): { available: boolean; alternative?: ConstructionNode } {
    const park = this.machineParkProfile(profileId);
    if (park.machines.includes(node.machine as MachineType)) return { available: true };

    const alternative = node.alternative_node_id ? this.node(node.alternative_node_id) : undefined;
    return alternative === undefined ? { available: false } : { available: false, alternative };
  }

  // ---------------------------------------------------------------- материалы

  material(id: string): Material {
    const found = this.materialsFile.materials.find((m) => m.id === id);
    if (!found) throw new Error(`неизвестный материал: ${id}`);
    return found;
  }

  materialsFor(category: Category): Material[] {
    return this.materialsFile.materials.filter((m) => m.applications.includes(category));
  }

  consumptionFor(category: Category): ConsumptionFormula {
    const found = this.consumption.formulas.find((f) => f.category === category);
    if (!found) throw new Error(`нет нормы расхода для категории: ${category}`);
    return found;
  }

  // ---------------------------------------------------------------- маркировка

  careProfile(id: string): CareProfile {
    const found = this.care.profiles.find((p) => p.id === id);
    if (!found) throw new Error(`неизвестный профиль ухода: ${id}`);
    return found;
  }

  /** Символы ухода в обязательном порядке ГОСТ ISO 3758: стирка → … → чистка. */
  careSymbolsOrdered(profileId: string): { group: string; id: string; label_ru: string }[] {
    const profile = this.careProfile(profileId);
    return this.care.order.flatMap((group) => {
      const variantId = profile.variants[group];
      if (!variantId) return [];
      const variant = this.care.variants.find((v) => v.id === variantId);
      if (!variant) throw new Error(`неизвестный символ ухода: ${variantId}`);
      return [{ group, id: variant.id, label_ru: variant.label_ru }];
    });
  }

  labelRequisites(): readonly LabelRequisite[] {
    return this.labeling.requisites;
  }

  /** Карта «видно с фото / не видно». Кормит промпт vision и блок предположений. */
  visibilityMap(): VisibilityMapFile {
    return this.visibility;
  }

  /**
   * Все непроверенные записи справочников.
   *
   * Список — рабочий бэклог верификации (CTO-SPEC.md §5): приоритет по частоте
   * использования значения. Он же не даёт забыть, что часть базы — экспертная оценка.
   */
  unverified(): { book: string; key: string; gap: string }[] {
    const out: { book: string; key: string; gap: string }[] = [];
    const push = (book: string, key: string, gap: string | undefined) => {
      if (gap) out.push({ book, key, gap });
    };

    for (const c of this.tolerances.classes)
      if (!c.verified) push('tolerance_classes', c.class, c.gap);
    for (const chart of this.sizes.charts) {
      for (const r of chart.rows) {
        if (!r.verified) push('size_charts_ru', `${chart.gender}/${r.ru}`, r.gap);
      }
    }
    for (const e of this.ease.entries) {
      if (!e.verified) push('ease_defaults', `${e.category}/${e.fit}/${e.fabric}`, e.gap);
    }
    for (const r of this.grading.rules) if (!r.verified) push('grading_increments', r.key, r.gap);
    for (const [category, tpl] of this.pomTemplates) {
      for (const p of tpl.points) {
        if (!p.verified) push(`pom_templates/${category}`, p.code, p.gap);
      }
    }
    for (const [category, def] of this.categoryDefaults) {
      if (!def.verified) push('category_defaults', category, def.gap);
    }
    for (const s of this.stitches.stitches) if (!s.verified) push('stitch_codes', s.code, s.gap);
    for (const s of this.seams.seams) if (!s.verified) push('seam_codes', s.code, s.gap);
    for (const n of this.construction.nodes)
      if (!n.verified) push('construction_nodes', n.id, n.gap);
    for (const p of this.machinePark.profiles) {
      if (!p.verified) push('machine_park_profiles', p.id, p.gap);
    }
    for (const m of this.materialsFile.materials) if (!m.verified) push('materials', m.id, m.gap);
    for (const f of this.consumption.formulas) {
      if (!f.verified) push('consumption_formulas', f.category, f.gap);
    }
    for (const p of this.care.profiles) if (!p.verified) push('care_symbols', p.id, p.gap);
    for (const r of this.labeling.requisites) {
      if (!r.verified) push('labeling_requirements', r.id, r.gap);
    }
    if (!this.visibility.verified) push('visibility_map', 'map', this.visibility.gap);
    return out;
  }
}

let cached: KnowledgeBase | undefined;

/** Справочники процесса. Загружаются лениво и переиспользуются. */
export function kb(): KnowledgeBase {
  cached ??= KnowledgeBase.load();
  return cached;
}
