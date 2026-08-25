/**
 * Учёт себестоимости генерации.
 *
 * Принцип CTO-SPEC.md §1.6: себестоимость — метрика первого класса,
 * логируется с первого дня. Цель: COGS ≤ 20% чека при ручном QA, ≤ 10% без него.
 */

export interface ModelPricing {
  /** USD за 1M входных токенов. */
  readonly inputPerMTok: number;
  /** USD за 1M выходных токенов. */
  readonly outputPerMTok: number;
}

/**
 * Прайс Claude API, first-party ставки.
 *
 * ⚠️ verified: false — сверить с https://docs.claude.com/en/docs/about-claude/pricing
 * перед первым отчётом CEO по себестоимости. Ставки меняются; у Sonnet 5
 * действует вводная цена ($2/$10) до 2026-08-31 — здесь намеренно стоит
 * полная ставка, чтобы оценка COGS была консервативной (сверху), а не оптимистичной.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-5': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  'claude-sonnet-5': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-haiku-4-5': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  'claude-fable-5': { inputPerMTok: 10.0, outputPerMTok: 50.0 },
};

/**
 * Множители кэширования промптов относительно ставки входных токенов.
 * ⚠️ verified: false — сверить там же. Чтение кэша дешевле записи на порядок,
 * поэтому контент-кэш vision (ADR-0003) окупается с первого повтора.
 */
export const CACHE_MULTIPLIER = {
  /** Запись в кэш, TTL 5 минут. */
  write5m: 1.25,
  /** Запись в кэш, TTL 1 час. */
  write1h: 2.0,
  /** Чтение из кэша. */
  read: 0.1,
} as const;

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens?: number;
  readonly cacheReadTokens?: number;
}

export interface StageCost extends TokenUsage {
  /** Стадия пайплайна: 'vision', 'assembly', 'flats', 'docgen'. */
  readonly stage: string;
  /** Пусто для детерминированных стадий — они не ходят в LLM и стоят ноль. */
  readonly model?: string;
  readonly usd: number;
  readonly ms: number;
  /** Результат взят из контент-кэша: обращения к API не было, стоимость ноль. */
  readonly cached: boolean;
}

export function priceUsage(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(
      `Нет прайса для модели "${model}". Добавь её в MODEL_PRICING — ` +
        `иначе себестоимость посчитается неверно и это никто не заметит.`,
    );
  }
  const perToken = pricing.inputPerMTok / 1_000_000;
  const outPerToken = pricing.outputPerMTok / 1_000_000;

  return (
    usage.inputTokens * perToken +
    usage.outputTokens * outPerToken +
    (usage.cacheWriteTokens ?? 0) * perToken * CACHE_MULTIPLIER.write5m +
    (usage.cacheReadTokens ?? 0) * perToken * CACHE_MULTIPLIER.read
  );
}

/**
 * Накопитель стоимости одной генерации.
 * Один ledger на один прогон пайплайна; в конце уезжает в лог и в БД.
 */
export class CostLedger {
  private readonly stages: StageCost[] = [];

  record(entry: Omit<StageCost, 'usd' | 'cached'> & { cached?: boolean }): StageCost {
    const cached = entry.cached ?? false;
    const usd = cached || !entry.model ? 0 : priceUsage(entry.model, entry);
    const stage: StageCost = { ...entry, usd, cached };
    this.stages.push(stage);
    return stage;
  }

  /** Свободная стадия: детерминированный код, LLM не вызывался. */
  recordFree(stage: string, ms: number): StageCost {
    return this.record({ stage, inputTokens: 0, outputTokens: 0, ms });
  }

  totalUsd(): number {
    return this.stages.reduce((sum, s) => sum + s.usd, 0);
  }

  totalMs(): number {
    return this.stages.reduce((sum, s) => sum + s.ms, 0);
  }

  entries(): readonly StageCost[] {
    return this.stages;
  }

  summary(): { usd: number; ms: number; stages: readonly StageCost[] } {
    return { usd: this.totalUsd(), ms: this.totalMs(), stages: this.entries() };
  }
}
