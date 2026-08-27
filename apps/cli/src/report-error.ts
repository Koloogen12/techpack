import { isSeamsterlyError } from '@seamsterly/core';

/**
 * Печать ошибки человеку — одним местом на все команды.
 *
 * Сообщение обещает «проверьте поля, перечисленные ниже», и пустота под
 * этой строкой хуже отсутствия подсказки: человек ищет список, которого
 * нет, и решает, что сломались мы. Список лежит в самой ошибке, и забыть
 * его печатать не должна ни одна команда — поэтому печать общая, а не
 * скопирована в каждый файл.
 */
export function reportCliError(error: unknown): void {
  if (isSeamsterlyError(error)) {
    console.error(`\n✗ ${error.userMessage}\n  → ${error.userAction}`);
    if (typeof error.details.issues === 'string') console.error(error.details.issues);
    return;
  }
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
}
