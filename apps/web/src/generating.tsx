import { useEffect, useRef, useState } from 'react';
import { api, type JobStatus } from './api';

/**
 * Экран генерации — вехи по хендоффу (экран 5), стадии НАСТОЯЩИЕ.
 *
 * Проценты не рисуются: выдуманный процент, застывший на 80%, хуже честного
 * «идёт сборка документа». Показываются реальные стадии пайплайна с часами —
 * то же деление, что в отчёте себестоимости.
 */

const STAGES = [
  { id: 'vision', label: 'АНАЛИЗ', hint: 'Разбираем снимки: пропорции, узлы, фактура полотна' },
  {
    id: 'assembly',
    label: 'СБОРКА',
    hint: 'Строим табель мер, градацию, конструкцию и спецификацию',
  },
  {
    id: 'render',
    label: 'ВИЗУАЛИЗАЦИЯ',
    hint: 'Рисуем изделие — документ важнее картинки, он её не ждёт',
  },
  { id: 'docgen', label: 'ДОКУМЕНТ', hint: 'Вёрстка листов и печать PDF' },
] as const;

const LINES = [
  'Отделяем крой от стилистического шума…',
  'Ширины меряем по разложенному изделию — половина обхвата, не путая с полной…',
  'Каждое значение получает источник: фото, анкета, справочник или предположение…',
  'Пройма следует из хорды по теореме Пифагора, а не из красивой картинки…',
  'Градация сдвигает якорь, не переписывая правило…',
];

export function Generating({
  jobId,
  onDone,
  onRetry,
}: {
  jobId: string;
  onDone: () => void;
  onRetry: () => void;
}) {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [line, setLine] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const s = await api.status(jobId);
        setStatus(s);
        if (s.stage === 'done' && !done.current) {
          done.current = true;
          clearInterval(poll);
          void api.event('generation_done', { jobId, seconds });
          setTimeout(onDone, 900);
        }
        if (s.stage === 'error') clearInterval(poll);
      } catch {
        /* переспросим на следующем тике */
      }
    }, 1200);
    const clock = setInterval(() => setSeconds((x) => x + 1), 1000);
    const rotator = setInterval(() => setLine((x) => (x + 1) % LINES.length), 4200);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      clearInterval(rotator);
    };
  }, [jobId]);

  const reached = new Set(status?.history.map((h) => h.stage) ?? []);
  const current = status?.stage ?? 'queued';
  const failed = current === 'error';
  const finished = current === 'done';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Вехи */}
      <div
        style={{
          display: 'flex',
          gap: 34,
          justifyContent: 'center',
          padding: '30px 20px 18px',
          alignItems: 'center',
        }}
      >
        {STAGES.map((s) => {
          const active = current === s.id;
          const passed = reached.has(s.id) && !active;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              {passed && !failed ? (
                <span style={{ color: 'var(--confirm-green)', fontSize: 14 }}>✓</span>
              ) : (
                <span
                  className="dot"
                  style={{
                    background: active ? 'var(--ink)' : 'var(--lib-grey)',
                    animation: active ? 'sfpulse 1.2s infinite' : undefined,
                  }}
                />
              )}
              <span
                className="kicker"
                style={{ color: active ? 'var(--ink)' : undefined, fontWeight: active ? 700 : 600 }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ height: 2, background: 'rgba(14,14,14,.08)' }}>
        <div
          style={{
            height: '100%',
            background: failed ? 'var(--data-red)' : 'var(--ink)',
            width: `${((STAGES.findIndex((s) => s.id === current) + 1) / STAGES.length) * 100 || 6}%`,
            transition: 'width 600ms ease',
          }}
        />
      </div>

      {/* Центр */}
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24 }}>
        {failed ? (
          <div className="card sfup" style={{ width: 440, padding: '34px 32px' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 20 }}>Не получилось</h2>
            <div style={{ color: 'var(--secondary)', lineHeight: 1.55, marginBottom: 8 }}>
              {status?.error?.message}
            </div>
            <div style={{ color: 'var(--secondary)', lineHeight: 1.55, marginBottom: 22 }}>
              {status?.error?.action}
            </div>
            <button className="btn" onClick={onRetry}>
              Повторить — лимит не списан
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 30, alignItems: 'center' }}>
            {STAGES.map((s, i) =>
              reached.has(s.id) || current === s.id ? (
                <div
                  key={s.id}
                  className="card"
                  style={{
                    width: 200,
                    padding: '22px 20px',
                    ['--tilt' as string]: `${(i % 2 ? 1 : -1) * (2 + i)}deg`,
                    animation: `sfup 500ms ease, sffloat 3.2s ease-in-out ${i * 0.35}s infinite`,
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                    {current === s.id && !finished ? '…' : '✓'} {s.label.toLowerCase()}
                  </div>
                  <div style={{ color: 'var(--secondary)', fontSize: 12.5, lineHeight: 1.5 }}>
                    {s.hint}
                  </div>
                  <div className="kicker" style={{ marginTop: 14 }}>
                    {current === s.id && !finished ? 'выполняется' : 'готово'}
                  </div>
                </div>
              ) : null,
            )}
            {finished && (
              <button className="btn sfup" onClick={onDone} style={{ padding: '16px 30px' }}>
                Открыть техпак →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Низ: строка статуса и таймер */}
      {!failed && (
        <div
          style={{
            padding: '0 24px 26px',
            display: 'flex',
            justifyContent: 'center',
            gap: 22,
            color: 'var(--secondary)',
            fontSize: 13,
          }}
        >
          <span>{LINES[line]}</span>
          <span className="mono">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} прошло
          </span>
        </div>
      )}
    </div>
  );
}
