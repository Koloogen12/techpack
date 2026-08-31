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

export interface SeamsterErrorOptions {
  /** Человеческим языком, для пользователя. Без терминов и кодов. */
  userMessage: string;
  /** Что сделать, чтобы починить. Всегда конкретное действие. */
  userAction: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class SeamsterError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly userAction: string;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, technicalMessage: string, options: SeamsterErrorOptions) {
    super(technicalMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SeamsterError';
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

export function isSeamsterError(e: unknown): e is SeamsterError {
  return e instanceof SeamsterError;
}
