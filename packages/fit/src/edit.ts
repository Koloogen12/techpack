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
  const template = base.pomTemplate(spec.style.category);
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
