import { createHash } from 'node:crypto';
import { CATEGORY_CLASS, categoryVisual, type Category } from '@seamster/kb';
import type { StyleSpec } from '@seamster/stylespec';

/**
 * Какой вещью изделие ЧИТАЕТСЯ — по узлам и табелю, а не по имени категории.
 *
 * Категория задаёт шаблон табеля и типовые узлы, и после правки фразой она
 * остаётся прежней: худи без капюшона собирается по табелю худи. Но глазами
 * это свитшот, и художник, и сторож обязаны видеть свитшот. Иначе промпт
 * просит «pullover hoodie», модель рисует капюшон, которого в спеке уже нет,
 * а сторож бракует верный лист за то, что на нём «sweatshirt».
 */
export function effectiveCategory(spec: StyleSpec): Category {
  const category = spec.style.category as Category;
  const nodes = new Set((spec.construction?.nodes ?? []).map((n) => n.node_id));
  const hood =
    nodes.has('hood_set_in') || nodes.has('hood_center_seam') || nodes.has('hood_lined_set_in');
  const zip = nodes.has('zip_set_in') || nodes.has('zip_full_length');
  const sleeve = sleeveLengthClass(spec);

  if (category === 'zip_hoodie' && !zip) return hood ? 'hoodie' : 'sweatshirt';
  if (category === 'hoodie' && !hood) return 'sweatshirt';
  if (category === 'sweatshirt' && hood) return 'hoodie';
  if (category === 'longsleeve' && sleeve === 'short') return 'tshirt';
  if (category === 'tshirt' && sleeve === 'long') return 'longsleeve';
  return category;
}

/**
 * Семьи категорий, которые на линейном рисунке различить нельзя.
 *
 * Свитер, лонгслив и свитшот на плоском листе — одна и та же вещь с длинным
 * рукавом; отличают их полотно и плотность, которых на штриховом рисунке нет.
 * Сторож отклонил верный лист джемпера как «longsleeve» ровно по этой
 * причине (23.09.2026). Внутри семьи различия ловят отдельные проверки:
 * капюшон, молния, карман, длина рукава и чек-лист признаков.
 */
const CATEGORY_FAMILIES: readonly (readonly Category[])[] = [
  ['tshirt', 'tank_top'],
  // Худи в семье нет: для него «свитшот» на листе означает пропавший
  // капюшон, и это отказ, а не синоним.
  ['longsleeve', 'sweatshirt', 'sweater', 'cardigan'],
  ['shirt', 'blouse'],
  ['jacket', 'coat', 'bomber'],
];

/** Категории, которые сторож вправе увидеть на листе: заявленная, читаемая и их семья. */
export function acceptedCategories(spec: StyleSpec): Category[] {
  const category = spec.style.category as Category;
  const effective = effectiveCategory(spec);
  const out = new Set<Category>([category, effective]);
  for (const family of CATEGORY_FAMILIES)
    if (family.includes(category) || family.includes(effective)) for (const c of family) out.add(c);
  return [...out];
}

/**
 * Длина рукава по табелю: T10 — от плеча. Пороги привязаны к руке, а не к
 * красивым числам: локоть у взрослого стоит примерно на 30–35 см от плечевой
 * точки, запястье — на 55–60.
 *
 * Считается только когда длину задал ЧЕЛОВЕК (правкой или по образцу).
 * Типовое значение шаблона — ратио категории, а не наблюдение: платье без
 * рукавов получает T10 из шаблона, и читать его как «рукав до запястья»
 * значило бы браковать верные листы. Иначе — null: решает категория.
 */
export function sleeveLengthClass(
  spec: StyleSpec,
): 'short' | 'three_quarter' | 'long' | 'none' | null {
  if (CATEGORY_CLASS[spec.style.category as Category] === 'bottom') return 'none';
  const deliberate = (code: string): boolean => {
    const c = spec.measurements.points.find((p) => p.code === code)?.base.confidence;
    return c === 'user_input' || c === 'fit_confirmed';
  };
  if (!deliberate('T10') && !deliberate('T11')) return null;
  const t10 = spec.measurements.points.find((p) => p.code === 'T10')?.base.value ?? null;
  if (t10 === null) return null;
  if (t10 <= 30) return 'short';
  if (t10 < 48) return 'three_quarter';
  return 'long';
}

/** Словами для художника — только когда длина рукава известна из табеля. */
export function sleeveWords(spec: StyleSpec): string {
  switch (sleeveLengthClass(spec)) {
    case 'short':
      return 'The sleeves are short, ending above the elbow.';
    case 'three_quarter':
      return 'The sleeves are three-quarter length, ending below the elbow.';
    case 'long':
      return 'The sleeves are full length, reaching the wrist.';
    default:
      return '';
  }
}

/**
 * Как назвать вещь художнику: по тому, чем она читается.
 *
 * Слово категории несёт типовую застёжку: «button-through cardigan». Когда
 * по фото планку заменила молния, слово обязано смениться вместе с узлами,
 * иначе художник рисует и молнию из признаков, и пуговицы из слова — ровно
 * так вышло на джемпере с диагональной молнией 23.09.2026.
 */
export function effectiveVisual(spec: StyleSpec): string {
  const category = effectiveCategory(spec);
  const nodes = new Set((spec.construction?.nodes ?? []).map((n) => n.node_id));
  const zip = nodes.has('zip_set_in') || nodes.has('zip_full_length');
  if (zip && !nodes.has('cardigan_placket') && !nodes.has('button_sew')) {
    if (category === 'cardigan')
      return (
        'zip-front knit cardigan closed by a separating zipper set into narrow plackets, ' +
        'a narrow ribbed neckband, ribbed cuffs and a ribbed hem, no hood'
      );
    if (category === 'sweater')
      return (
        'knit sweater with a separating zipper at the front, a ribbed neckband, ' +
        'ribbed cuffs and a ribbed hem'
      );
  }
  return categoryVisual(category, spec.base.fabric_kind);
}

/**
 * Отпечаток ФОРМЫ изделия — того, что видно на рисунке: категория по узлам,
 * набор узлов, уверенные дизайн-признаки, посадка, длина рукава и пропорция.
 *
 * Именно по нему рисунок считается устаревшим, а не по тексту промпта:
 * иначе каждая правка формулировки для художника объявляла бы устаревшими
 * все листы в паках, хотя вещь на них та же.
 */
export function shapeFingerprint(spec: StyleSpec): string {
  const value = (code: string): number | null =>
    spec.measurements.points.find((p) => p.code === code)?.base.value ?? null;
  const length = value('T01');
  const chest = value('T03');
  const shape =
    length !== null && chest !== null
      ? length / chest > 1.35
        ? 'long'
        : length / chest > 1.15
          ? 'balanced'
          : 'boxy'
      : null;
  const slice = {
    category: effectiveCategory(spec),
    nodes: (spec.construction?.nodes ?? []).map((n) => n.node_id).sort(),
    features: (spec.design?.features ?? [])
      .filter((f) => f.certainty !== 'low')
      .map((f) => `${f.zone}:${f.en.toLowerCase()}`)
      .sort(),
    fit: spec.base.fit_intent,
    sleeve: sleeveLengthClass(spec),
    shape,
  };
  return createHash('sha256').update(JSON.stringify(slice)).digest('hex').slice(0, 32);
}

/** Отпечаток для «Внешнего вида»: форма плюс цвет, полотно и его поверхность. */
export function lookFingerprint(spec: StyleSpec): string {
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  const slice = {
    shape: shapeFingerprint(spec),
    colorways: (spec.bom?.colorways ?? []).map((c) => [
      c.id,
      c.swatch?.hex ?? c.hex_approx ?? null,
    ]),
    shell: shell?.material_id ?? null,
    surface: spec.bom?.fabric_surface?.value ?? null,
    pattern:
      spec.artwork?.placements.find((a) => a.kind === 'allover')?.size_cm.width.value ?? null,
  };
  return createHash('sha256').update(JSON.stringify(slice)).digest('hex').slice(0, 32);
}
