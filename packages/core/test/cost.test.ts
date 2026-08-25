import { describe, expect, it } from 'vitest';
import { CostLedger, priceUsage } from '../src/index.js';

describe('себестоимость', () => {
  it('считает цену вызова по прайсу модели', () => {
    // 14k входных + 4k выходных на Opus 5 — типичная генерация из 6 фото.
    const usd = priceUsage('claude-opus-5', { inputTokens: 14_000, outputTokens: 4_000 });
    expect(usd).toBeCloseTo(14_000 * 5e-6 + 4_000 * 25e-6, 10);
    // Проверка порядка: техпак должен стоить центы, а не доллары.
    expect(usd).toBeLessThan(0.5);
  });

  it('падает на неизвестной модели вместо тихого нуля', () => {
    expect(() => priceUsage('gpt-whatever', { inputTokens: 1, outputTokens: 1 })).toThrow(
      /Нет прайса/,
    );
  });

  it('чтение из кэша дешевле обычного входа', () => {
    const fresh = priceUsage('claude-opus-5', { inputTokens: 10_000, outputTokens: 0 });
    const cached = priceUsage('claude-opus-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 10_000,
    });
    expect(cached).toBeLessThan(fresh);
  });
});

describe('CostLedger', () => {
  it('суммирует стадии и время', () => {
    const ledger = new CostLedger();
    ledger.record({
      stage: 'vision',
      model: 'claude-opus-5',
      inputTokens: 14_000,
      outputTokens: 4_000,
      ms: 12_000,
    });
    ledger.recordFree('assembly', 40);
    ledger.recordFree('docgen', 2_100);

    expect(ledger.entries()).toHaveLength(3);
    expect(ledger.totalMs()).toBe(14_140);
    expect(ledger.totalUsd()).toBeGreaterThan(0);
  });

  it('кэшированная стадия стоит ноль — повтор генерации бесплатен', () => {
    const ledger = new CostLedger();
    ledger.record({
      stage: 'vision',
      model: 'claude-opus-5',
      inputTokens: 14_000,
      outputTokens: 4_000,
      ms: 8,
      cached: true,
    });
    expect(ledger.totalUsd()).toBe(0);
  });

  it('детерминированные стадии не стоят ничего', () => {
    const ledger = new CostLedger();
    ledger.recordFree('assembly', 40);
    expect(ledger.totalUsd()).toBe(0);
  });
});
