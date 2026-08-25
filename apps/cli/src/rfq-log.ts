/**
 * Журнал ответов фабрик — данные эксперимента H1.
 *
 * Рассылка на тридцать фабрик даёт ответ не на вопрос «понравился ли пак»,
 * а на три числа: сколько вообще ответили, по какой цене и с каким
 * минимальным тиражом. Всё остальное — впечатления, и они не считаются.
 *
 * Формат — CSV, потому что журнал ведёт человек в таблице, а не приложение.
 * Разбор нарочно снисходителен к оформлению: лишние пробелы, запятая вместо
 * точки в цене, пустые строки. Придираться к формату файла, который
 * заполняют руками между звонками, значит не получить данных вовсе.
 */

export interface RfqResponse {
  factory: string;
  city?: string | undefined;
  /** Дата отправки листа, ISO. */
  sent: string;
  /** Дата ответа, ISO. Пусто — не ответили. */
  replied?: string | undefined;
  /** Цена за изделие, ₽. Пусто — не назвали. */
  price?: number | undefined;
  /** Минимальная партия, шт. */
  moq?: number | undefined;
  /** Срок от подтверждения образца до отгрузки, дней. */
  lead_days?: number | undefined;
  /** Берётся ли за заказ. Это и есть критерий RAT-1. */
  takes: boolean;
  note?: string | undefined;
}

export const RFQ_LOG_HEADER = [
  'factory',
  'city',
  'sent',
  'replied',
  'price',
  'moq',
  'lead_days',
  'takes',
  'note',
] as const;

/** Пустой журнал с шапкой и строкой-примером. */
export function emptyRfqLog(): string {
  return (
    RFQ_LOG_HEADER.join(',') +
    '\n' +
    '# фабрика,город,дата отправки,дата ответа,цена за изделие,MOQ,срок дней,берётся да/нет,заметка\n' +
    '# Пример: ООО Швейник,Иваново,2026-09-01,2026-09-03,780,100,21,да,просит образец полотна\n'
  );
}

function cell(row: string[], i: number): string {
  return (row[i] ?? '').trim();
}

/** Число из ячейки, заполненной человеком: «1 200», «780,50», «~800». */
function numberOf(raw: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d,.-]/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const YES = new Set(['да', 'yes', 'y', '+', 'true', '1', 'берётся', 'берется']);

export interface ParsedLog {
  responses: RfqResponse[];
  /** Строки, которые не удалось разобрать. Молча их терять нельзя. */
  problems: string[];
}

export function parseRfqLog(csv: string): ParsedLog {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const responses: RfqResponse[] = [];
  const problems: string[] = [];

  for (const [i, line] of lines.entries()) {
    const row = line.split(',');
    if (i === 0 && cell(row, 0).toLowerCase() === 'factory') continue;

    const factory = cell(row, 0);
    if (!factory) {
      problems.push(`строка ${i + 1}: нет названия фабрики — пропущена`);
      continue;
    }
    const sent = cell(row, 2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sent)) {
      problems.push(
        `${factory}: дата отправки «${sent}» не в формате ГГГГ-ММ-ДД — строка пропущена`,
      );
      continue;
    }

    const replied = cell(row, 3);
    responses.push({
      factory,
      ...(cell(row, 1) ? { city: cell(row, 1) } : {}),
      sent,
      ...(replied ? { replied } : {}),
      ...(numberOf(cell(row, 4)) === undefined ? {} : { price: numberOf(cell(row, 4)) }),
      ...(numberOf(cell(row, 5)) === undefined ? {} : { moq: numberOf(cell(row, 5)) }),
      ...(numberOf(cell(row, 6)) === undefined ? {} : { lead_days: numberOf(cell(row, 6)) }),
      takes: YES.has(cell(row, 7).toLowerCase()),
      ...(cell(row, 8) ? { note: cell(row, 8) } : {}),
    });
  }

  return { responses, problems };
}

export interface RfqSummary {
  sent: number;
  replied: number;
  takes: number;
  /** Доля ответивших и доля берущихся — от ОТПРАВЛЕННЫХ, не от ответивших. */
  reply_rate: number;
  take_rate: number;
  median_price: number | null;
  price_range: [number, number] | null;
  median_moq: number | null;
  median_lead_days: number | null;
  median_reply_days: number | null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2) * 10) / 10;
}

export function summariseRfq(responses: readonly RfqResponse[]): RfqSummary {
  const replied = responses.filter((r) => r.replied);
  const takes = responses.filter((r) => r.takes);
  const prices = responses.map((r) => r.price).filter((x): x is number => x !== undefined);
  const days = replied
    .map((r) => (Date.parse(r.replied!) - Date.parse(r.sent)) / 86_400_000)
    .filter((d) => Number.isFinite(d) && d >= 0);

  return {
    sent: responses.length,
    replied: replied.length,
    takes: takes.length,
    // Доли считаются от ОТПРАВЛЕННЫХ. Считать от ответивших — обычный способ
    // получить красивую цифру: девять молчаний и один «да» дадут сто процентов.
    reply_rate: responses.length ? replied.length / responses.length : 0,
    take_rate: responses.length ? takes.length / responses.length : 0,
    median_price: median(prices),
    price_range: prices.length ? [Math.min(...prices), Math.max(...prices)] : null,
    median_moq: median(responses.map((r) => r.moq).filter((x): x is number => x !== undefined)),
    median_lead_days: median(
      responses.map((r) => r.lead_days).filter((x): x is number => x !== undefined),
    ),
    median_reply_days: median(days),
  };
}

/** Порог стоп-крана 1: «≥6 из 10 фабрик берут документ в работу». */
export const RAT1_TAKE_RATE = 0.6;

/**
 * Согласование числительного.
 *
 * «1 фабрик не ответили» в отчёте, который читает человек, выглядит как
 * недоделка — и он справедливо переносит это ощущение на сами числа.
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
