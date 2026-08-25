/**
 * Структурное логирование.
 *
 * Правило CTO-SPEC.md §1.8: никакого пользовательского контента в логах.
 * Фото, тексты пользователя и содержимое промптов сюда не попадают — только
 * хеши, идентификаторы и метрики.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

class JsonLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel,
    private readonly bindings: LogFields,
    private readonly sink: (line: string) => void,
  ) {}

  private write(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    this.sink(
      JSON.stringify({
        level,
        msg,
        time: new Date().toISOString(),
        ...this.bindings,
        ...fields,
      }),
    );
  }

  debug = (msg: string, fields?: LogFields): void => this.write('debug', msg, fields);
  info = (msg: string, fields?: LogFields): void => this.write('info', msg, fields);
  warn = (msg: string, fields?: LogFields): void => this.write('warn', msg, fields);
  error = (msg: string, fields?: LogFields): void => this.write('error', msg, fields);

  child(bindings: LogFields): Logger {
    return new JsonLogger(this.minLevel, { ...this.bindings, ...bindings }, this.sink);
  }
}

export function createLogger(
  options: { level?: LogLevel; bindings?: LogFields; sink?: (line: string) => void } = {},
): Logger {
  return new JsonLogger(
    options.level ?? 'info',
    options.bindings ?? {},
    options.sink ?? ((line) => process.stdout.write(line + '\n')),
  );
}

/** Логгер-заглушка для тестов. */
export const silentLogger: Logger = createLogger({ level: 'error', sink: () => {} });
