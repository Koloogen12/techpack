import { kb as defaultKb, type ConstructionNode, type KnowledgeBase } from '@seamster/kb';
import { parseStyleSpec, type StyleSpec } from '@seamster/stylespec';

/**
 * Класс стежка узла — выбор бренда поверх справочника.
 *
 * Справочник даёт узлу типовой стежок (ISO 4915 = ГОСТ 12807) и машину под
 * него. Бренд вправе решить иначе: подгибку не распошивом, а двухигольной
 * челночной. Меняется не одна цифра: за классом стежка идёт машина, за
 * машиной — проверка парка цеха и операция техпоследовательности. Всё это
 * пересчитывается здесь, чтобы таблица узлов, схема шва и техпоследовательность
 * говорили одно.
 */
export interface StitchEditResult {
  spec: StyleSpec;
  /** Что изменилось — по-русски. */
  changed_ru: string | null;
  rejected: string | null;
}

export function setNodeStitch(
  spec: StyleSpec,
  nodeId: string,
  stitchCode: string,
  base: KnowledgeBase = defaultKb(),
): StitchEditResult {
  const construction = spec.construction;
  const node = construction?.nodes.find((n) => n.node_id === nodeId);
  if (!construction || !node)
    return { spec, changed_ru: null, rejected: `узла «${nodeId}» в изделии нет` };
  let stitch;
  try {
    stitch = base.stitch(stitchCode);
  } catch {
    return { spec, changed_ru: null, rejected: `класса стежка ${stitchCode} нет в справочнике` };
  }
  if (node.stitch_code === stitchCode) return { spec, changed_ru: null, rejected: null };

  // Парк машин проверяется той же функцией, что при сборке: узел из
  // справочника с новым стежком и машиной под него.
  let registry: ConstructionNode | null = null;
  try {
    registry = base.node(nodeId);
  } catch {
    registry = null;
  }
  const probe: ConstructionNode = {
    ...(registry ?? {
      id: nodeId,
      zone: node.zone as ConstructionNode['zone'],
      label_ru: node.label_ru,
      plain_ru: node.plain_ru,
      seam_code: node.seam_code,
      stitch_code: node.stitch_code,
      spi: node.spi,
      machine: node.machine as ConstructionNode['machine'],
      specialty: node.specialty as ConstructionNode['specialty'],
      seam_allowance_cm: { min: 0.5, max: 1.5, default: node.seam_allowance_cm.value },
      visible_on_photo: node.visible_on_photo,
      requires_special_equipment: node.requires_special_equipment,
      alternative_node_id: node.alternative?.node_id ?? null,
      applies_to: [spec.style.category as ConstructionNode['applies_to'][number]],
      verified: false,
      source: 'spec',
      gap: 'узел вне справочника',
      photo_key: null,
      flat_line: null,
      flat_line_note_ru: 'узел вне справочника',
      label_en: node.label_en ?? node.label_ru,
      plain_en: node.plain_en ?? node.plain_ru,
      label_zh: node.label_zh ?? node.label_ru,
      plain_zh: node.plain_zh ?? node.plain_ru,
      translation_verified: false,
      translation_gap: 'узел вне справочника',
    }),
    stitch_code: stitchCode,
    machine: stitch.machine as ConstructionNode['machine'],
  };
  const check = base.checkMachinePark(probe, construction.machine_park_profile);

  const nodes = construction.nodes.map((n) =>
    n.node_id !== nodeId
      ? n
      : {
          ...n,
          stitch_code: stitchCode,
          machine: stitch.machine,
          stitch_by_user: true,
          requires_special_equipment: !check.available,
          alternative: check.available
            ? null
            : check.alternative
              ? {
                  node_id: check.alternative.id,
                  label_ru: check.alternative.label_ru,
                  machine: check.alternative.machine,
                }
              : n.alternative,
        },
  );
  // Узел вне парка и без замены схема не пропустит — и правильно: фабрика
  // получила бы требование без выхода. Отказываем словами.
  const edited = nodes.find((n) => n.node_id === nodeId)!;
  if (edited.requires_special_equipment && !edited.alternative)
    return {
      spec,
      changed_ru: null,
      rejected:
        `стежок ${stitchCode} требует машины «${stitch.machine}», которой нет в парке цеха, ` +
        'а замены под базовый парк у узла нет',
    };
  const sequence = construction.sequence.map((s) =>
    s.node_id === nodeId ? { ...s, machine: stitch.machine } : s,
  );
  return {
    spec: parseStyleSpec({ ...spec, construction: { ...construction, nodes, sequence } }),
    changed_ru: `Стежок узла «${node.label_ru}»: ${node.stitch_code} → ${stitchCode} (${stitch.name_ru}), машина ${stitch.machine}`,
    rejected: null,
  };
}

/** Список классов стежка для выбора в кабинете — код, имя, машина, применение. */
export function stitchOptions(base: KnowledgeBase = defaultKb()) {
  return base.stitchCodes().map((s) => ({
    code: s.code,
    name_ru: s.name_ru,
    name_en: s.name_en,
    machine: s.machine,
    application_ru: s.application_ru,
  }));
}
