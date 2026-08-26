import { useEffect, useRef, useState } from 'react';
import { api, type JobStatus } from './api.js';
import { useStore } from './store.js';

/**
 * Экран генерации — хендофф, экран 5: вехи АНАЛИЗ → ГЕНЕРАЦИЯ → СБОРКА,
 * карточки с левитацией, правая панель «Добавить детали», строка статуса,
 * таймер. Стадии НАСТОЯЩИЕ: карта на onStage пайплайна, проценты
 * не выдумываются.
 */

const MILESTONES = [
  { id: 'АНАЛИЗ', stages: ['vision'] },
  { id: 'ГЕНЕРАЦИЯ', stages: ['assembly', 'render'] },
  { id: 'СБОРКА', stages: ['docgen'] },
] as const;

const CARDS = [
  {
    at: 'vision',
    title: 'Анализ снимков',
    hint: 'Пропорции, узлы, фактура полотна — и что по фото не видно',
  },
  {
    at: 'assembly',
    title: 'Табель мер и градация',
    hint: 'Замеры с допусками, размерный ряд, конструкция, спецификация',
  },
  { at: 'render', title: 'Визуализация', hint: 'Документ важнее картинки — он её не ждёт' },
  { at: 'docgen', title: 'Документ', hint: 'Вёрстка листов, чертёж, PDF' },
] as const;

const LINES = [
  'Отделяем крой от стилистического шума…',
  'Ширины меряем по разложенному изделию — половина обхвата…',
  'Каждое значение получает источник: фото, анкета, справочник или предположение…',
  'Пройма следует из хорды по теореме Пифагора…',
  'Градация сдвигает якорь, не переписывая правило…',
];

export function Generating() {
  const s = useStore();
  const jobId = s.generatingJob!;
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [line, setLine] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [details, setDetails] = useState({ brand: '', name: '', season: '', description: '' });
  const [detailsSent, setDetailsSent] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    done.current = false;
    const poll = setInterval(async () => {
      try {
        const st = await api.status(jobId);
        setStatus(st);
        if ((st.stage === 'done' || st.stage === 'error') && !done.current) {
          done.current = st.stage === 'done';
          if (st.stage === 'done') {
            void api.event('generation_done', { jobId, seconds });
            void s.refreshJobs();
          }
          clearInterval(poll);
        }
      } catch {
        /* следующий тик */
      }
    }, 1200);
    const clock = setInterval(() => setSeconds((x) => x + 1), 1000);
    const rot = setInterval(() => setLine((x) => (x + 1) % LINES.length), 4200);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      clearInterval(rot);
    };
  }, [jobId]);

  const reached = new Set(status?.history.map((h) => h.stage) ?? []);
  const current = status?.stage ?? 'queued';
  const failed = current === 'error';
  const finished = current === 'done';
  const mIndex = MILESTONES.findIndex((m) => m.stages.includes(current as never));
  const activeMilestone = finished ? MILESTONES.length : mIndex === -1 ? 0 : mIndex;

  const sendDetails = async () => {
    const patch = Object.fromEntries(Object.entries(details).filter(([, v]) => v.trim()));
    if (!Object.keys(patch).length) return;
    await api.meta(jobId, patch as Record<string, string>);
    setDetailsSent(true);
    s.showToast('Детали сохранены — попадут в документ');
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Вехи */}
      <div
        style={{
          display: 'flex',
          gap: 34,
          justifyContent: 'center',
          padding: '26px 20px 16px',
          alignItems: 'center',
        }}
      >
        {MILESTONES.map((m, i) => {
          const active = i === activeMilestone && !finished && !failed;
          const passed = i < activeMilestone || finished;
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
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
                style={{
                  color: active || passed ? 'var(--ink)' : undefined,
                  fontWeight: active ? 700 : 600,
                }}
              >
                {m.id}
              </span>
            </div>
          );
        })}
        <span className="mono" style={{ fontSize: 11, color: 'var(--secondary)' }}>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} прошло
        </span>
        <button
          onClick={() => s.go('home')}
          style={{
            border: 0,
            background: 'none',
            color: 'var(--secondary)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          ✕ Свернуть
        </button>
      </div>
      <div style={{ height: 2, background: 'rgba(14,14,14,.08)' }}>
        <div
          style={{
            height: '100%',
            background: failed ? 'var(--data-red)' : 'var(--ink)',
            width: finished
              ? '100%'
              : `${Math.min(96, ((activeMilestone + 0.5) / MILESTONES.length) * 100)}%`,
            transition: 'width 800ms ease',
          }}
        />
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Центр: карточки */}
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24 }}>
          {failed ? (
            <div className="card sfup" style={{ width: 440, padding: '32px 30px' }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 20 }}>Не получилось</h2>
              <div style={{ color: 'var(--secondary)', lineHeight: 1.55, marginBottom: 8 }}>
                {status?.error?.message}
              </div>
              <div style={{ color: 'var(--secondary)', lineHeight: 1.55, marginBottom: 20 }}>
                {status?.error?.action}
              </div>
              <button className="btn" onClick={() => s.startWizard()}>
                Повторить — лимит не списан
              </button>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                gap: 26,
                alignItems: 'center',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              {CARDS.filter((c) => reached.has(c.at) || current === c.at).map((c, i) => (
                <div
                  key={c.at}
                  className="card"
                  style={{
                    width: 196,
                    padding: '20px 18px',
                    ['--rot' as string]: `${(i % 2 ? 1 : -1) * (2.5 + i * 0.5)}deg`,
                    animation: `sfcard 500ms ease, sffloat 3.2s ease-in-out ${i * 0.35}s infinite alternate`,
                  }}
                >
                  <b style={{ fontSize: 14.5 }}>
                    {current === c.at && !finished ? '…' : '✓'} {c.title}
                  </b>
                  <div
                    style={{
                      color: 'var(--secondary)',
                      fontSize: 12,
                      lineHeight: 1.5,
                      margin: '6px 0 12px',
                    }}
                  >
                    {c.hint}
                  </div>
                  <span className="kicker" style={{ fontSize: 8 }}>
                    {current === c.at && !finished ? 'выполняется' : 'готово'}
                  </span>
                </div>
              ))}
              {!finished && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    color: 'var(--secondary)',
                    fontSize: 13,
                  }}
                >
                  <span
                    className="dot"
                    style={{ background: 'var(--ink)', animation: 'sfpulse 1.2s infinite' }}
                  />
                  Пайплайн работает…
                </div>
              )}
              {finished && (
                <button
                  className="btn sfup"
                  style={{ padding: '16px 30px', fontSize: 15 }}
                  onClick={() => s.openDoc(jobId)}
                >
                  Открыть техпак →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Правая панель «Добавить детали» */}
        {!failed &&
          (panelOpen ? (
            <div
              className="sfup"
              style={{
                width: 312,
                flex: 'none',
                background: '#fff',
                borderLeft: '1px solid var(--hairline)',
                padding: '22px 20px',
                overflow: 'auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <b style={{ fontSize: 15 }}>Добавить детали</b>
                <button
                  onClick={() => setPanelOpen(false)}
                  style={{ border: 0, background: 'none', color: 'var(--secondary)' }}
                >
                  ✕
                </button>
              </div>
              <div
                style={{
                  color: 'var(--secondary)',
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  marginBottom: 16,
                }}
              >
                Пока пайплайн работает, заполните паспорт изделия — попадёт в документ.
              </div>
              {(
                [
                  ['brand', 'Бренд'],
                  ['name', 'Название модели'],
                  ['season', 'Сезон'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} style={{ display: 'block', marginBottom: 12 }}>
                  <div className="kicker" style={{ fontSize: 8.5, marginBottom: 5 }}>
                    {label}
                  </div>
                  <input
                    style={{ width: '100%' }}
                    value={details[k]}
                    onChange={(e) => setDetails({ ...details, [k]: e.target.value })}
                  />
                </label>
              ))}
              <label style={{ display: 'block', marginBottom: 14 }}>
                <div className="kicker" style={{ fontSize: 8.5, marginBottom: 5 }}>
                  Описание
                </div>
                <textarea
                  rows={4}
                  style={{ width: '100%', resize: 'vertical' }}
                  value={details.description}
                  onChange={(e) => setDetails({ ...details, description: e.target.value })}
                />
              </label>
              <button className="btn" style={{ width: '100%' }} onClick={() => void sendDetails()}>
                {detailsSent ? '✓ Сохранено' : 'Подтвердить детали →'}
              </button>
            </div>
          ) : (
            <button
              className="btn"
              onClick={() => setPanelOpen(true)}
              style={{
                position: 'absolute',
                top: 70,
                right: 20,
                padding: '10px 16px',
                fontSize: 12.5,
              }}
            >
              + Добавить детали, пока ждёте
            </button>
          ))}
      </div>

      {!failed && (
        <div
          style={{
            padding: '0 24px 22px',
            textAlign: 'center',
            color: 'var(--secondary)',
            fontSize: 13,
          }}
        >
          {finished ? 'Готово — документ собран из данных, не из картинок.' : LINES[line]}
        </div>
      )}
    </div>
  );
}
