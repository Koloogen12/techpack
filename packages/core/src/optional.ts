/**
 * Убирает ключи со значением undefined.
 *
 * Нужно из-за exactOptionalPropertyTypes: в этом режиме «поля нет» и «поле
 * равно undefined» — разные вещи. Данные, пришедшие через zod из JSON, имеют
 * форму `поле?: T | undefined`, а внутренние типы — `поле?: T`, и разложить
 * одно в другое напрямую нельзя.
 *
 * Правило строгое намеренно: оно ловит опечатки в именах полей, а не только
 * этот случай. Помощник живёт в ядре, потому что нужен на каждой границе
 * между JSON и внутренними типами.
 */
export type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

export function defined<T extends object>(value: T): Defined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Defined<T>;
}
