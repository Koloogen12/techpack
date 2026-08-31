import { describe, expect, it, vi } from 'vitest';
import { SeamsterError } from '@seamster/core';
import { reportCliError } from '../src/report-error.js';

/**
 * Ошибка обещает «проверьте поля, перечисленные ниже». Пустота под этой
 * строкой хуже отсутствия подсказки: человек ищет список, которого нет,
 * и решает, что сломались мы.
 */
describe('печать ошибки человеку', () => {
  const capture = (error: unknown): string => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...a) => void lines.push(a.join(' ')));
    reportCliError(error);
    spy.mockRestore();
    return lines.join('\n');
  };

  it('печатает и объяснение, и список полей', () => {
    const out = capture(
      new SeamsterError('SPEC_INVALID', 'внутреннее', {
        userMessage: 'В бланке не хватает данных.',
        userAction: 'Проверьте поля, перечисленные ниже, и повторите',
        details: { issues: '  method: недопустимое значение' },
      }),
    );
    expect(out).toContain('В бланке не хватает данных.');
    expect(out).toContain('Проверьте поля');
    expect(out).toContain('method: недопустимое значение');
  });

  it('без списка полей печатает только объяснение', () => {
    const out = capture(
      new SeamsterError('SPEC_INVALID', 'внутреннее', {
        userMessage: 'Не вышло.',
        userAction: 'Повторите',
      }),
    );
    expect(out).toContain('Не вышло.');
    expect(out).not.toContain('undefined');
  });

  it('чужую ошибку не проглатывает', () => {
    // Незнакомая ошибка — наша, а не пользователя: показать её текст
    // честнее, чем подменить бодрым «что-то пошло не так».
    expect(capture(new Error('порвался сокет'))).toContain('порвался сокет');
  });
});
