import {
  observationRu,
  type EdgeKind,
  type ObservationKey,
  type Observations,
  type Observed,
} from '@seamster/core';
import type { Category, FabricKind, KnowledgeBase } from '@seamster/kb';

/**
 * Наблюдение по словарю → набор узлов. Детерминированно и без регулярок.
 *
 * Категория даёт типовой набор узлов; снимок сильнее категории. Каждое
 * правило ниже говорит одно: увидели X — узел Y заменяется на Z, уходит или
 * добавляется, если реестр допускает его в этой категории. Правило молчит,
 * когда взгляд не уверен (low) или ничего не видел (not_visible): молчание
 * оставляет типовой узел с честным статусом «подтвердить по образцу».
 */
export interface ObservationPlan {
  /** Узел → узел-замена: операция техпоследовательности меняет слова. */
  swap: Map<string, string>;
  /** Узлы, которых на вещи нет: уходят вместе с операциями. */
  drop: Set<string>;
  /** Узлы, которых категория не давала, а снимок показал. */
  add: string[];
  notes: string[];
}

const CLOSURE_NODES = [
  'zip_set_in',
  'zip_placket_topstitch',
  'zip_full_length',
  'cardigan_placket',
  'cardigan_placket_topstitch',
  'placket_buttonholes',
  'button_sew',
  'front_placket',
  'polo_placket',
  'invisible_zip_back',
  'fly_zip',
];
const ZIP_NODES = ['zip_set_in', 'zip_placket_topstitch', 'zip_full_length', 'invisible_zip_back'];
const HOOD_NODES = [
  'hood_set_in',
  'hood_center_seam',
  'hood_drawcord_casing',
  'hood_eyelets',
  'hood_buttonhole_exit',
  'hood_lined_set_in',
  'hood_lined_center_seam',
];
const POCKET_BODY_NODES = [
  'kangaroo_pocket',
  'patch_pocket',
  'pocket_side_seam',
  'pocket_jetted',
  'pocket_welt',
];
const POCKET_FINISH_NODES = ['pocket_bartack', 'pocket_reinforce_lockstitch'];
const SLEEVE_NODES = [
  'sleeve_set_in',
  'sleeve_set_in_woven',
  'cuff_rib',
  'sleeve_hem_coverstitch',
  'sleeve_hem_topstitch',
  'cuff_barrel',
  'cuff_elastic_casing',
];

const SOFT_EDGE: readonly EdgeKind[] = ['turned_hem', 'binding', 'raw', 'none'];

export function planFromObservations(
  obs: Observations,
  category: Category,
  fabric: FabricKind,
  nodeIds: readonly string[],
  base: KnowledgeBase,
): ObservationPlan {
  const plan: ObservationPlan = { swap: new Map(), drop: new Set(), add: [], notes: [] };
  const applicable = new Set(base.nodesFor(category).map((n) => n.id));
  const present = new Set(nodeIds);
  const has = (id: string) => present.has(id) && !plan.drop.has(id) && !plan.swap.has(id);
  const hasAny = (ids: readonly string[]) => ids.some(has);
  const can = (id: string) => applicable.has(id);
  const sure = <T extends string>(o: Observed<T>): boolean =>
    o.confidence !== 'low' && o.value !== 'not_visible';
  const seen = (key: ObservationKey, value: string) => observationRu(key, value);

  const swap = (from: string, to: string) => {
    if (!has(from) || !can(to) || from === to) return false;
    plan.swap.set(from, to);
    present.add(to);
    return true;
  };
  const drop = (id: string) => {
    if (!has(id)) return false;
    plan.drop.add(id);
    return true;
  };
  const add = (id: string) => {
    if (!can(id) || present.has(id) || plan.add.includes(id)) return false;
    plan.add.push(id);
    present.add(id);
    return true;
  };
  const knit = fabric === 'knit';

  // --- Капюшон ----------------------------------------------------------------
  if (sure(obs.hood) && obs.hood.value === 'no' && hasAny(HOOD_NODES)) {
    const gone = HOOD_NODES.filter(drop);
    if (gone.length)
      plan.notes.push(
        `На фото ${seen('hood', 'no')}: узлы капюшона (${gone.length}) убраны вместе с ` +
          `операциями, точки капюшона уходят из табеля. Категория остаётся, документ ` +
          `называет вещь по узлам.`,
      );
  }

  // --- Горловина --------------------------------------------------------------
  if (sure(obs.neckline)) {
    const v = obs.neckline.value;
    const narrow =
      v === 'crew_binding' ||
      v === 'v_neck' ||
      v === 'v_notch_zip' ||
      v === 'scoop' ||
      v === 'boat' ||
      v === 'square';
    if (narrow && has('neck_rib_band')) {
      if (swap('neck_rib_band', 'neck_binding'))
        plan.notes.push(
          `На фото ${seen('neckline', v)}: бейка-риб кольцом из типового набора заменена ` +
            `на окантовку узкой бейкой, высота бейки в табеле приведена к высоте окантовки. ` +
            `Подтвердите по образцу.`,
        );
    } else if (v === 'plain_facing' && has('neck_rib_band')) {
      if (swap('neck_rib_band', 'neck_facing') || swap('neck_rib_band', 'neck_binding'))
        plan.notes.push(
          `На фото ${seen('neckline', v)}: бейка-риб заменена на обработку чистого края.`,
        );
    } else if (
      (v === 'crew_rib_band' || v === 'mock_neck' || v === 'turtleneck') &&
      !has('neck_rib_band')
    ) {
      if (swap('neck_binding', 'neck_rib_band') || add('neck_rib_band'))
        plan.notes.push(`На фото ${seen('neckline', v)}: добавлена бейка-риб кольцом.`);
    } else if (v === 'hood' && !hasAny(HOOD_NODES)) {
      const extra = ['hood_center_seam', 'hood_set_in'].filter(add);
      plan.notes.push(
        extra.length
          ? `На фото ${seen('neckline', v)}: добавлены узлы капюшона (${extra.join(', ')}); ` +
              `кулиску, люверсы и подкладку капюшона подтвердите по образцу.`
          : `На фото ${seen('neckline', v)}, а в этой категории узлов капюшона нет: соберите ` +
              `вещь как худи или подтвердите горловину по образцу.`,
      );
    }
  }

  // --- Застёжка ---------------------------------------------------------------
  if (sure(obs.closure)) {
    const v = obs.closure.value;
    const zip = v === 'zip_center_full' || v === 'zip_center_partial' || v === 'zip_asymmetric';
    const buttons = v === 'buttons_full' || v === 'buttons_partial' || v === 'snaps';
    if (v === 'none' && hasAny(CLOSURE_NODES)) {
      const gone = CLOSURE_NODES.filter(drop);
      plan.notes.push(
        `На фото ${seen('closure', v)}: узлы застёжки (${gone.join(', ')}) убраны вместе с ` +
          `операциями и фурнитурой.`,
      );
    } else if (zip) {
      if (has('cardigan_placket')) {
        swap('cardigan_placket', 'zip_set_in');
        swap('cardigan_placket_topstitch', 'zip_placket_topstitch');
        drop('placket_buttonholes');
        drop('button_sew');
        plan.notes.push(
          `На фото ${seen('closure', v)}, а не планка с пуговицами из типового набора: ` +
            `узлы планки заменены на втачивание разъёмной молнии, петли и пуговицы убраны ` +
            `вместе с операциями. Ход молнии смотрите в дизайн-признаках и на рисунке.`,
        );
      } else if (!hasAny(ZIP_NODES) && !hasAny(['front_placket', 'polo_placket', 'fly_zip'])) {
        const extra = ['zip_set_in', 'zip_placket_topstitch'].filter(add);
        if (extra.length)
          plan.notes.push(
            `На фото ${seen('closure', v)}, а в типовом наборе категории застёжки нет: ` +
              `добавлены втачивание разъёмной молнии и отстрочка планок; место операций ` +
              `в последовательности подтверждает технолог.`,
          );
      }
    } else if (v === 'zip_invisible_back' && !has('invisible_zip_back')) {
      if (add('invisible_zip_back'))
        plan.notes.push(`На фото ${seen('closure', v)}: добавлена потайная молния.`);
    } else if (buttons) {
      if (has('zip_set_in') && can('cardigan_placket')) {
        swap('zip_set_in', 'cardigan_placket');
        swap('zip_placket_topstitch', 'cardigan_placket_topstitch');
        add('placket_buttonholes');
        add('button_sew');
        plan.notes.push(
          `На фото ${seen('closure', v)}, а не молния из типового набора: узлы молнии ` +
            `заменены на планку с петлями и пуговицами.`,
        );
      } else if (!hasAny(CLOSURE_NODES)) {
        const extra = [
          'cardigan_placket',
          'cardigan_placket_topstitch',
          'placket_buttonholes',
          'button_sew',
        ].filter(add);
        if (extra.length)
          plan.notes.push(
            `На фото ${seen('closure', v)}, а в типовом наборе застёжки нет: добавлена ` +
              `планка с петлями и пуговицами (${extra.length} узла).`,
          );
      }
    }
  }

  // --- Низ рукава и низ изделия -----------------------------------------------
  const edge = (
    key: 'cuff' | 'hem',
    band: string,
    soft: string,
    softWoven: string,
    what: string,
  ) => {
    const o = obs[key];
    if (!sure(o)) return;
    const v = o.value;
    const plain = knit ? soft : softWoven;
    if (v === 'rib_band' && !has(band)) {
      if (swap(soft, band) || swap(softWoven, band) || add(band))
        plan.notes.push(`На фото ${seen(key, v)}: добавлена ${what}-риб отдельной деталью.`);
    } else if (SOFT_EDGE.includes(v) && has(band)) {
      if (swap(band, plain) || swap(band, knit ? softWoven : soft))
        plan.notes.push(
          `На фото ${seen(key, v)}: ${what}-риб из типового набора заменена на подгибку, ` +
            `высота ${what === 'манжета' ? 'манжеты' : 'пояса'} уходит из табеля. ` +
            `Подтвердите по образцу.`,
        );
    } else if ((v === 'elastic' || v === 'drawcord') && key === 'cuff' && has(band)) {
      if (swap(band, 'cuff_elastic_casing'))
        plan.notes.push(`На фото ${seen(key, v)}: манжета-риб заменена на кулиску с резинкой.`);
    } else if (v === 'woven_cuff' && key === 'cuff' && !has('cuff_barrel')) {
      if (swap('sleeve_hem_topstitch', 'cuff_barrel') || swap(band, 'cuff_barrel'))
        plan.notes.push(`На фото ${seen(key, v)}: добавлена обтачная манжета с петлёй.`);
    }
  };
  edge('cuff', 'cuff_rib', 'sleeve_hem_coverstitch', 'sleeve_hem_topstitch', 'манжета');
  edge('hem', 'waistband_rib', 'hem_coverstitch', 'hem_topstitch_lockstitch', 'пояс');

  // --- Карманы ----------------------------------------------------------------
  if (sure(obs.pocket)) {
    const v = obs.pocket.value;
    const wanted: Record<string, string | undefined> = {
      kangaroo: 'kangaroo_pocket',
      patch: 'patch_pocket',
      in_seam: 'pocket_side_seam',
      jetted: 'pocket_jetted',
      welt: 'pocket_welt',
    };
    if (v === 'none') {
      const gone = POCKET_BODY_NODES.filter(drop);
      if (gone.length) {
        POCKET_FINISH_NODES.forEach(drop);
        plan.notes.push(
          `На фото ${seen('pocket', v)}: карман (${gone.join(', ')}) и его закрепки убраны ` +
            `вместе с операциями, точки кармана уходят из табеля.`,
        );
      }
    } else if (wanted[v] && !has(wanted[v]!)) {
      const other = POCKET_BODY_NODES.filter((id) => id !== wanted[v] && has(id));
      if (other.length === 1 && swap(other[0]!, wanted[v]!)) {
        plan.notes.push(`На фото ${seen('pocket', v)}: карман типового набора заменён.`);
      } else if (add(wanted[v]!)) {
        POCKET_FINISH_NODES.forEach((id) => (has(id) ? false : add(id)));
        plan.notes.push(
          `На фото ${seen('pocket', v)}, а в типовом наборе категории кармана нет: узел ` +
            `добавлен вместе с закрепками; размеры кармана подтвердите по образцу.`,
        );
      } else if (!can(wanted[v]!)) {
        plan.notes.push(
          `На фото ${seen('pocket', v)}, но такого узла в реестре для этой категории нет — ` +
            `опишите карман технологу отдельно.`,
        );
      }
    }
  }

  // --- Рукав ------------------------------------------------------------------
  if (sure(obs.sleeve)) {
    const v = obs.sleeve.value;
    if (v === 'sleeveless' && hasAny(SLEEVE_NODES)) {
      const gone = SLEEVE_NODES.filter(drop);
      if (has('side_sleeve_seam')) swap('side_sleeve_seam', 'side_seam_plain');
      if (can('armhole_binding')) add('armhole_binding');
      plan.notes.push(
        `На фото ${seen('sleeve', v)}: узлы рукава (${gone.length}) убраны, пройма ` +
          `обрабатывается окантовкой; точки рукава уходят из табеля.`,
      );
    } else if (v === 'raglan' || v === 'dolman' || v === 'kimono') {
      plan.notes.push(
        `На фото ${seen('sleeve', v)}, а узел втачивания в реестре — по плечевой точке: ` +
          `шов рукава подтвердите с технологом, точки плеча и проймы меряются по шву реглана.`,
      );
    }
  }

  return plan;
}

/** Высота бейки горловины по словарю: стойка 5 см, гольф 12, окантовка — по узлу. */
export function neckHeightFromObservation(obs: Observations | undefined): number | null {
  if (!obs || obs.neckline.confidence === 'low') return null;
  switch (obs.neckline.value) {
    case 'mock_neck':
      return 5;
    case 'turtleneck':
      return 12;
    default:
      return null;
  }
}
