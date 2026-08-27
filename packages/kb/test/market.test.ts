import { describe, expect, it } from 'vitest';
import { CATEGORIES, kb } from '../src/index.js';

/**
 * Нормы приёмки рынка — нормативные ссылки, по которым фабрика выпускает
 * партию и отвечает за неё. Ошибка здесь не «неточность перевода», а
 * неверный стандарт в договоре.
 */
describe('нормы приёмки по рынкам', () => {
  const base = kb();

  it('для китайского комплекта нормы есть', () => {
    expect(base.marketFor('zh')).not.toBeNull();
  });

  it('для русского комплекта норм рынка нет — там ГОСТ', () => {
    // Российский лист приёмки собран из ГОСТ 23193-78 и живёт отдельно:
    // дублировать его сюда значило бы завести два источника одной правды.
    expect(base.marketFor('ru')).toBeNull();
  });

  it('у каждой нашей категории есть стандарт выпуска', () => {
    // 执行标准 — первое, что читает китайский ОТК. Категория без стандарта
    // означала бы пустую строку на месте, где она ищет ответ.
    const market = base.marketFor('zh')!;
    for (const category of CATEGORIES) {
      expect(base.productStandardFor(market, category), category).not.toBeNull();
    }
  });

  it('непроверенные нормы называют, что именно подтвердить', () => {
    // Флаг «не проверено» без объяснения нечем оспорить через полгода.
    const market = base.marketFor('zh')!;
    for (const s of market.product_standards) {
      if (!s.verified) expect(s.gap, s.code).toBeTruthy();
    }
    if (!market.sampling.verified) expect(market.sampling.gap).toBeTruthy();
  });

  it('правило выборочного контроля названо вместе с международным аналогом', () => {
    // По GB/T 2828.1 фабрика узнаёт стандарт, по ISO 2859-1 — инспектор
    // любой страны. Назвать один без другого значит сузить читателя.
    const s = base.marketFor('zh')!.sampling;
    expect(s.code).toContain('GB/T 2828');
    expect(s.equivalent).toContain('ISO 2859');
    expect(s.aql_major).toBeLessThan(s.aql_minor);
  });

  it('ярлычная шкала КНР — это 号型, а не буква', () => {
    // 号型 задаёт рост, обхват груди и полнотную группу разом; буквы S–XL
    // в КНР не стандарт, а маркетинг рядом с ним.
    expect(base.sizeLabelFor('women', 46, 'cn')).toMatch(/^\d+\/\d+[A-Z]$/);
  });

  it('размера вне сетки шкала не выдумывает', () => {
    expect(base.sizeLabelFor('women', 999, 'cn')).toBeNull();
  });
});
