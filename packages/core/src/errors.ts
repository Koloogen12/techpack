/**
 * Доменные ошибки.
 *
 * Правило PRD.md §6: «ошибка всегда с причиной и действием».
 * Поэтому userMessage и userAction — обязательные поля, а не опциональные:
 * выбросить ошибку без объяснения пользователю нельзя.
 */
export type ErrorCode =
  | 'KB_INVALID'
  | 'KB_MISSING'
  | 'SPEC_INVALID'
  | 'SPEC_VERSION_UNSUPPORTED'
  | 'VISION_FAILED'
  | 'VISION_SCHEMA_MISMATCH'
  | 'CATEGORY_UNSUPPORTED'
  | 'PHOTO_UNUSABLE'
  | 'ASSEMBLY_FAILED'
  | 'RENDER_FAILED'
  | 'CONFIG_MISSING';

export interface SpecFormErrorOptions {
  /** Человеческим языком, для пользователя. Без терминов и кодов. */
  userMessage: string;
  /** Что сделать, чтобы починить. Всегда конкретное действие. */
  userAction: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class SpecFormError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly userAction: string;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, technicalMessage: string, options: SpecFormErrorOptions) {
    super(technicalMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SpecFormError';
    this.code = code;
    this.userMessage = options.userMessage;
    this.userAction = options.userAction;
    this.details = options.details ?? {};
  }

  /** Представление для API и логов. Технический текст наружу не отдаётся. */
  toPublic(): { code: ErrorCode; message: string; action: string } {
    return { code: this.code, message: this.userMessage, action: this.userAction };
  }
}

export function isSpecFormError(e: unknown): e is SpecFormError {
  return e instanceof SpecFormError;
}

/** Категория вне трикотажного ядра MVP — честный отказ, а не плохой результат (ux/00 §18). */
export function categoryUnsupported(category: string, supported: readonly string[]): SpecFormError {
  return new SpecFormError('CATEGORY_UNSUPPORTED', `category "${category}" is outside MVP scope`, {
    userMessage: `Пока мы делаем техпаки только для трикотажа: ${supported.join(', ')}. Для «${category}» результат был бы хуже, чем нужно фабрике, — поэтому не беремся.`,
    userAction: 'Записаться в лист ожидания этой категории или выбрать другую',
    details: { category, supported },
  });
}
