import { describe, expect, it } from 'vitest';
import {
  assume,
  countAssumptions,
  derive,
  fitConfirmed,
  fromBase,
  fromPhoto,
  mapTracked,
  mergeTracked,
  needsConfirmation,
  track,
  userInput,
  CONFIDENCE_LEVELS,
  confidenceRank,
} from '../src/index.js';

describe('иерархия доверия', () => {
  it('ранжирует статусы строго по убыванию, без равных', () => {
    const ranks = CONFIDENCE_LEVELS.map(confidenceRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(new Set(ranks).size).toBe(CONFIDENCE_LEVELS.length);
  });

  it('примерка образца бьёт всё остальное', () => {
    for (const level of CONFIDENCE_LEVELS.slice(1)) {
      expect(confidenceRank('fit_confirmed')).toBeGreaterThan(confidenceRank(level));
    }
  });
});

describe('mergeTracked', () => {
  it('оставляет более доверенный источник независимо от порядка', () => {
    const guess = assume(50, 'kb:default');
    const measured = userInput(52, 'user:wizard');

    expect(mergeTracked(guess, measured).value).toBe(52);
    expect(mergeTracked(measured, guess).value).toBe(52);
  });

  it('при равном ранге выигрывает более поздний', () => {
    const first = fromPhoto(50, 'vision:v1');
    const second = fromPhoto(51, 'vision:v1');
    expect(mergeTracked(first, second).value).toBe(51);
  });

  it('примерка перекрывает даже то, что указал пользователь', () => {
    const stated = userInput(52, 'user:wizard');
    const actual = fitConfirmed(53.5, 'fit:round1');
    expect(mergeTracked(stated, actual)).toEqual(actual);
  });
});

describe('происхождение значения', () => {
  it('mapTracked меняет значение, но сохраняет источник', () => {
    const cm = fromBase(50, 'kb:pom_templates/tshirt#T03', 'типовое для M');
    const doubled = mapTracked(cm, (v) => v * 2);

    expect(doubled.value).toBe(100);
    expect(doubled.confidence).toBe('default_from_base');
    expect(doubled.source).toBe('kb:pom_templates/tshirt#T03');
    expect(doubled.note).toBe('типовое для M');
  });

  it('derive переписывает и статус, и источник — унаследовать чужое доверие нельзя', () => {
    const anchor = userInput(92, 'user:wizard.base_size');
    const derived = derive(anchor, (v) => v / 2 + 8, 'estimated_from_photo', 'engine:pom/chest');

    expect(derived.value).toBe(54);
    expect(derived.confidence).toBe('estimated_from_photo');
    expect(derived.source).toBe('engine:pom/chest');
  });

  it('note не появляется в объекте, если его не передали', () => {
    expect(Object.hasOwn(track(1, 'assumption', 's'), 'note')).toBe(false);
  });
});

describe('счётчик предположений', () => {
  it('считает только assumption — это цифра в кнопке «Предположения: N»', () => {
    const values = [
      userInput(1, 'a'),
      fromPhoto(2, 'b'),
      fromBase(3, 'c'),
      assume(4, 'd'),
      assume(5, 'e'),
      fitConfirmed(6, 'f'),
    ];
    expect(countAssumptions(values)).toBe(2);
    expect(values.filter(needsConfirmation)).toHaveLength(2);
  });
});
