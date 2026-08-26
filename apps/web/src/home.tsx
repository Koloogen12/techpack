import { useState } from 'react';
import { useStore } from './store.js';
import { Menu, Silhouette, StatusChip } from './ui.js';
import { api } from './api.js';

/**
 * Домашняя и «Все паки» — хендофф, экраны 2 и 3.
 */
export function Home() {
  const s = useStore();
  const last = s.jobs.find((j) => j.stage === 'done');

  return (
    <div className="sfup" style={{ maxWidth: 880, margin: '0 auto', padding: '64px 32px' }}>
      <div className="kicker" style={{ marginBottom: 14 }}>
        Seamsterly · бета
      </div>
      <h1
        style={{
          fontSize: 44,
          fontWeight: 700,
          letterSpacing: '-1px',
          margin: '0 0 12px',
          lineHeight: 1.1,
        }}
      >
        От фото — к производству,
        <br />с ясностью
      </h1>
      <div
        style={{
          color: 'var(--secondary)',
          fontSize: 15.5,
          lineHeight: 1.6,
          maxWidth: 560,
          marginBottom: 28,
        }}
      >
        Фотография изделия превращается в производственный техпак: чертёж, замеры с допусками и
        градацией, материалы, узлы обработки. Каждое значение отвечает на вопрос «откуда это число».
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 40,
          flexWrap: 'wrap',
        }}
      >
        <button
          className="btn"
          style={{ padding: '15px 30px', fontSize: 15 }}
          onClick={() => s.startWizard()}
        >
          Создать техпак
        </button>
        {[
          { label: 'Чертёж' },
          { label: '3D-рендер' },
          { label: 'Принт' },
          { label: 'Примерка' },
        ].map((q) => (
          <button
            key={q.label}
            className="chip"
            onClick={() => {
              if (q.label === 'Чертёж') s.startWizard();
              else {
                s.showToast(`${q.label} — скоро; записали интерес`);
                void api.event('mode_interest', { mode: q.label });
              }
            }}
          >
            {q.label}
          </button>
        ))}
      </div>

      {last ? (
        <div
          className="card"
          onClick={() => s.openDoc(last.id)}
          style={{
            padding: '20px 24px',
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            cursor: 'pointer',
            maxWidth: 560,
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 12,
              border: '1px solid var(--hairline)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Silhouette category={last.category} size={40} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="kicker" style={{ fontSize: 8.5 }}>
              Продолжить
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 3 }}>{last.name}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--tertiary)', marginTop: 2 }}>
              {last.article}
            </div>
          </div>
          <StatusChip stage={last.stage} />
        </div>
      ) : (
        <div className="panel" style={{ padding: '18px 22px', maxWidth: 560 }}>
          <b>Начните с 1–2 фото.</b>
          <div
            style={{ color: 'var(--secondary)', fontSize: 13.5, marginTop: 6, lineHeight: 1.55 }}
          >
            Хватит снимка спереди на ровном фоне. Каждый следующий ракурс — спинка, бок, разложенное
            на столе — открывает новые точки замера.
          </div>
        </div>
      )}

      <div style={{ marginTop: 26 }}>
        <a style={{ cursor: 'pointer', fontSize: 14 }} onClick={() => s.go('packs')}>
          Все паки списком →
        </a>
      </div>
    </div>
  );
}

export function Packs() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('Все');
  const [menu, setMenu] = useState<string | null>(null);

  const filtered = s.jobs.filter((j) => {
    const text = `${j.name} ${j.article}`.toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    if (filter === 'Готов') return j.stage === 'done';
    if (filter === 'Черновик') return j.stage === 'queued';
    if (filter === 'В работе')
      return j.stage !== 'done' && j.stage !== 'queued' && j.stage !== 'error';
    return true;
  });

  return (
    <div className="sfup" style={{ maxWidth: 1030, margin: '0 auto', padding: '48px 32px' }}>
      <h1 style={{ fontSize: 28, letterSpacing: '-0.5px', margin: '0 0 20px' }}>Все паки</h1>
      <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по названию и артикулу"
          style={{ width: 280 }}
        />
        {['Все', 'Готов', 'Черновик', 'В работе'].map((f) => (
          <button
            key={f}
            className={`chip ${filter === f ? 'on' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 16,
        }}
      >
        {filtered.map((j) => (
          <div
            key={j.id}
            className="card"
            style={{ padding: 16, cursor: 'pointer', position: 'relative' }}
            onClick={() =>
              j.stage === 'done'
                ? s.openDoc(j.id)
                : j.stage === 'queued'
                  ? s.startWizard(j.id)
                  : s.startGenerating(j.id)
            }
          >
            <div
              style={{
                height: 120,
                borderRadius: 10,
                border: '1px solid var(--hairline)',
                display: 'grid',
                placeItems: 'center',
                marginBottom: 12,
                background: 'var(--hover-bg)',
              }}
            >
              <Silhouette category={j.category} size={72} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{j.name}</div>
            <div
              className="mono"
              style={{ fontSize: 10, color: 'var(--tertiary)', margin: '3px 0 8px' }}
            >
              {j.article}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <StatusChip stage={j.stage} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === j.id ? null : j.id);
                }}
                style={{ border: 0, background: 'none', fontSize: 16, color: 'var(--secondary)' }}
              >
                ⋮
              </button>
            </div>
            {menu === j.id && (
              <Menu
                onClose={() => setMenu(null)}
                items={[
                  {
                    label: 'Переименовать',
                    onClick: () => {
                      const name = prompt('Новое название', j.name);
                      if (!name?.trim()) return;
                      void api.meta(j.id, { name: name.trim() }).then(() => void s.refreshJobs());
                    },
                  },
                  {
                    label: 'Дублировать',
                    onClick: () => void api.duplicate(j.id).then(() => void s.refreshJobs()),
                  },
                  { label: 'Взять за основу', onClick: () => s.startWizard(j.id) },
                  {
                    label: 'Удалить',
                    danger: true,
                    onClick: () =>
                      void api.remove(j.id).then(() => {
                        void s.refreshJobs();
                        s.showToast(`Пак «${j.name}» удалён`);
                      }),
                  },
                ]}
              />
            )}
          </div>
        ))}

        <div
          onClick={() => s.startWizard()}
          style={{
            border: '1.5px dashed var(--lib-grey)',
            borderRadius: 14,
            minHeight: 210,
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
            color: 'var(--secondary)',
            fontSize: 14.5,
          }}
        >
          + Новый техпак
        </div>
      </div>

      {!filtered.length && q && (
        <div style={{ marginTop: 30, color: 'var(--secondary)' }}>
          По «{q}» ничего не нашлось.{' '}
          <a style={{ cursor: 'pointer' }} onClick={() => setQ('')}>
            Сбросить
          </a>
        </div>
      )}
    </div>
  );
}
