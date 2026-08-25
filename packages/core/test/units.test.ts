import { describe, expect, it } from 'vitest';
import {
  circumferenceToHalf,
  clamp,
  cmToInches,
  formatLength,
  halfToCircumference,
  inchesToCm,
  parseLength,
  roundCm,
} from '../src/index.js';

describe('конвертация единиц', () => {
  it('round-trip см → дюймы → см не расходится больше 0.05 см', () => {
    for (let cm = 1; cm <= 200; cm += 0.5) {
      const back = inchesToCm(cmToInches(cm));
      expect(Math.abs(back - cm)).toBeLessThan(0.05);
    }
  });

  it('ввод в дюймах сохраняется в сантиметрах с точностью 0.1', () => {
    expect(parseLength(20, 'in')).toBe(50.8);
    expect(parseLength(26, 'in')).toBe(66);
  });

  it('ввод в сантиметрах округляется до 0.1', () => {
    expect(parseLength(52.34, 'cm')).toBe(52.3);
    expect(parseLength(52.35, 'cm')).toBe(52.4);
  });
});

describe('округление', () => {
  it('держит точность 0.1 см', () => {
    expect(roundCm(52.04)).toBe(52);
    expect(roundCm(52.05)).toBe(52.1);
    expect(roundCm(-1.26)).toBe(-1.3);
  });

  it('промежуточное округление накапливает ошибку — показываем почему запрещено', () => {
    // Градация: базовое 52.0 + 6 шагов по 1.05 см.
    const step = 1.05;
    let naive = 52;
    for (let i = 0; i < 6; i++) naive = roundCm(naive + step);

    const correct = roundCm(52 + step * 6);

    expect(correct).toBe(58.3);
    expect(naive).toBe(58.6);
    // 0.3 см ошибки на шести шагах — на краю ряда это уже брак посадки.
    expect(Math.abs(naive - correct)).toBeCloseTo(0.3, 10);
    expect(naive).not.toBe(correct);
  });
});

describe('half vs обхват', () => {
  it('переводит в обе стороны', () => {
    expect(circumferenceToHalf(104)).toBe(52);
    expect(halfToCircumference(52)).toBe(104);
  });
});

describe('форматирование', () => {
  it('см с одним знаком, дюймы с двумя', () => {
    expect(formatLength(52, 'cm')).toBe('52.0');
    expect(formatLength(50.8, 'in')).toBe('20.00');
  });
});

describe('clamp', () => {
  it('ограничивает диапазоном', () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(25, 10, 20)).toBe(20);
    expect(clamp(15, 10, 20)).toBe(15);
  });

  it('падает на перевёрнутом диапазоне вместо тихого мусора', () => {
    expect(() => clamp(15, 20, 10)).toThrow(RangeError);
  });
});
