import { track } from '@seamster/core';
import { kb as defaultKb, type KnowledgeBase } from '@seamster/kb';
import { parseStyleSpec, type StyleSpec } from '@seamster/stylespec';

/**
 * Ручная правка замера — киллер-фича живого документа.
 *
 * Пользователь исправляет число в таблице, и чертёж перестраивается,
 * потому что он ПОСТРОЕН из таблицы, а не нарисован рядом с ней.
 * Конкурент этого не может: у него чертёж — растровая картинка.
 *
 * Родня applyFitting, но с двумя принципиальными отличиями:
 *  - статус «указано вами», а не «подтверждено по образцу» — человек
 *    сообщил замысел, а не померил вещь;
 *  - составную точку править нельзя ВООБЩЕ: она тождество своих частей,
 *    и форма правки — правка части.
 */

export interface EditResult {
  spec: StyleSpec;
  /** Что изменилось, включая пересчитанные составные точки. */
  changed: { code: string; from_cm: number; to_cm: number }[];
  /** Почему правка отклонена. Пусто — принята. */
  rejected: string | null;
}

export function editMeasurement(
  spec: StyleSpec,
  code: string,
  valueCm: number,
  base: KnowledgeBase = defaultKb(),
): EditResult {
  const template = base.pomTemplate(spec.style.category, spec.base.fabric_kind);
  const entry = template.points.find((p) => p.code === code);
  const point = spec.measurements.points.find((p) => p.code === code);

  if (!entry || !point) {
    return { spec, changed: [], rejected: `точки ${code} нет в этом изделии` };
  }
  if (entry.derivation === 'composed') {
    const parts = (entry.composed_of ?? []).map((p) => p.code).join(' и ');
    return {
      spec,
      changed: [],
      rejected:
        `${code} считается из ${parts} тождественно и напрямую не правится — ` +
        `исправьте ${parts.split(' и ')[0]}`,
    };
  }
  if (!Number.isFinite(valueCm) || valueCm <= 0 || valueCm > 250) {
    return { spec, changed: [], rejected: 'значение вне разумных пределов' };
  }

  const changed: EditResult['changed'] = [];
  const rounded = Math.round(valueCm * 10) / 10;
  const source = 'user:workspace/measurements';

  const points = spec.measurements.points.map((p) => {
    if (p.code !== code) return p;
    changed.push({ code, from_cm: p.base.value, to_cm: rounded });
    const shift = rounded - p.base.value;
    return {
      ...p,
      base: track(rounded, 'user_input' as const, source, 'исправлено в рабочем документе'),
      // Градация сдвигается вместе с базой: правило не изменилось,
      // изменился якорь.
      graded: p.graded.map((g) => ({
        ...g,
        value: { ...g.value, value: Math.round((g.value.value + shift) * 10) / 10 },
      })),
    };
  });

  // Составные точки пересчитываются из новых частей — документ не имеет
  // права противоречить сам себе.
  const valueOf = (c: string): number | undefined => points.find((p) => p.code === c)?.base.value;

  const recomputed = points.map((p) => {
    const e = template.points.find((x) => x.code === p.code);
    if (e?.derivation !== 'composed') return p;
    const parts = e.composed_of ?? [];
    if (!parts.some((part) => part.code === code)) return p;

    let sum = 0;
    for (const part of parts) {
      const v = valueOf(part.code);
      if (v === undefined) return p;
      sum += v * part.factor;
    }
    const value = Math.round(sum * 10) / 10;
    if (value === p.base.value) return p;

    changed.push({ code: p.code, from_cm: p.base.value, to_cm: value });
    const shift = value - p.base.value;
    return {
      ...p,
      base: track(
        value,
        p.base.confidence,
        `engine:pom/composed(${parts.map((x) => `${x.factor}×${x.code}`).join('+')})`,
        'пересчитано после правки части',
      ),
      graded: p.graded.map((g) => ({
        ...g,
        value: { ...g.value, value: Math.round((g.value.value + shift) * 10) / 10 },
      })),
    };
  });

  const draft = {
    ...spec,
    measurements: { ...spec.measurements, points: recomputed },
    meta: {
      ...spec.meta,
      assumptions_count:
        recomputed.filter(
          (p) => p.base.confidence === 'assumption' || p.tolerance.confidence === 'assumption',
        ).length +
        (spec.construction?.nodes.filter((n) => n.presence.confidence === 'assumption').length ??
          0) +
        (spec.bom?.lines.filter(
          (l) => l.composition.confidence === 'assumption' || l.gsm?.confidence === 'assumption',
        ).length ?? 0),
    },
  };

  return { spec: parseStyleSpec(draft), changed, rejected: null };
}

/**
 * Подтверждение замера по образцу.
 *
 * Отдельная операция, а не разновидность правки: значение не меняется —
 * меняется то, откуда мы его знаем. «Указано вами» означает замысел,
 * «подтверждено по образцу» — что человек взял отшитую вещь и померил её.
 * Для фабрики это разные вещи: по подтверждённому замеру она шьёт партию,
 * по указанному ждёт образец.
 *
 * Раньше пометка жила только на экране и пропадала при обновлении страницы:
 * человек сверял вещь с образцом, отмечал точку и терял эту работу молча.
 */
export function confirmMeasurement(
  spec: StyleSpec,
  code: string,
  confirmed: boolean,
  base: KnowledgeBase = defaultKb(),
): EditResult {
  const template = base.pomTemplate(spec.style.category, spec.base.fabric_kind);
  const entry = template.points.find((p) => p.code === code);
  const point = spec.measurements.points.find((p) => p.code === code);
  if (!entry || !point) {
    return { spec, changed: [], rejected: `точки ${code} нет в этом изделии` };
  }
  // Составная точка тождественна своим частям: подтверждать её отдельно
  // значит утверждать, что сумма померена, а слагаемые нет.
  if (entry.derivation === 'composed') {
    const parts = (entry.composed_of ?? []).map((p) => p.code).join(' и ');
    return {
      spec,
      changed: [],
      rejected: `${code} считается из ${parts} — подтверждайте их, а не сумму`,
    };
  }

  const already = point.base.confidence === 'fit_confirmed';
  if (already === confirmed) return { spec, changed: [], rejected: null };

  // Снятие возвращает статус «указано вами»: прежний уровень восстановить
  // неоткуда, а число в таблице человек уже видел и оставил. Занижать его
  // до «оценки по фото» значило бы соврать в другую сторону.
  const level = confirmed ? ('fit_confirmed' as const) : ('user_input' as const);
  const source = confirmed ? 'fit:sample-confirmed' : 'user:workspace/measurements';
  const note = confirmed ? 'померено на образце' : 'подтверждение снято';

  const points = spec.measurements.points.map((p) =>
    p.code === code ? { ...p, base: track(p.base.value, level, source, note) } : p,
  );

  const draft = {
    ...spec,
    measurements: { ...spec.measurements, points },
    meta: {
      ...spec.meta,
      assumptions_count:
        points.filter(
          (p) => p.base.confidence === 'assumption' || p.tolerance.confidence === 'assumption',
        ).length +
        (spec.construction?.nodes.filter((n) => n.presence.confidence === 'assumption').length ??
          0) +
        (spec.bom?.lines.filter(
          (l) => l.composition.confidence === 'assumption' || l.gsm?.confidence === 'assumption',
        ).length ?? 0),
    },
  };
  return { spec: parseStyleSpec(draft), changed: [], rejected: null };
}

/**
 * Набор символов ухода, выбранный человеком.
 *
 * По умолчанию он считается из состава полотна: это правильно и для
 * большинства вещей достаточно. Но бренд знает про изделие то, чего не знает
 * состав — вышивку, которая не любит барабан, фурнитуру, которая боится
 * утюга, — и его решение обязано доезжать до ярлыка. Раньше выбор жил только
 * на экране: в документ уходил набор по составу, и человек об этом не знал.
 */
export function setCareProfile(
  spec: StyleSpec,
  profileId: string,
  base: KnowledgeBase = defaultKb(),
): EditResult {
  if (!spec.labels) return { spec, changed: [], rejected: 'в этом документе нет маркировки' };
  let symbols;
  try {
    symbols = base.careSymbolsOrdered(profileId);
  } catch {
    return { spec, changed: [], rejected: `набора символов «${profileId}» нет в справочнике` };
  }
  const draft = { ...spec, labels: { ...spec.labels, care_symbols: symbols } };
  return { spec: parseStyleSpec(draft), changed: [], rejected: null };
}
