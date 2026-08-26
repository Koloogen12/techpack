import { useState } from 'react';
import { api } from './api.js';
import { useStore } from './store.js';
import { Menu, Silhouette, StatusChip } from './ui.js';
import { Logo } from './main.js';

/**
 * Сайдбар — хендофф, экран 7. Постоянный, стекло, 300px.
 * Шапка · счётчик · быстрые действия · коллекции · одиночные паки ·
 * библиотека · тариф · футер с балансом и аккаунтом.
 */
export function Sidebar() {
  const s = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const [quickOpen, setQuickOpen] = useState(true);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accOpen, setAccOpen] = useState(false);
  const [colFormOpen, setColFormOpen] = useState(false);
  const [colName, setColName] = useState('');
  const [packMenu, setPackMenu] = useState<string | null>(null);
  const [openCols, setOpenCols] = useState<Set<string>>(new Set());

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          position: 'fixed',
          left: 10,
          top: 44,
          zIndex: 40,
          width: 34,
          height: 34,
          borderRadius: 10,
          background: '#fff',
          border: '1px solid rgba(14,14,14,.12)',
          boxShadow: '0 10px 26px rgba(14,14,14,.14)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="Развернуть панель"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0E0E0E"
          strokeWidth="1.7"
          strokeLinecap="round"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
    );
  }

  const inCollection = new Set(s.collections.flatMap((c) => c.packIds));
  const single = s.jobs.filter((j) => !inCollection.has(j.id));
  const credits = { used: Math.min(s.jobs.length, 3), total: 3 };

  const packRow = (id: string) => {
    const j = s.jobs.find((x) => x.id === id);
    if (!j) return null;
    return (
      <div
        key={j.id}
        onClick={() =>
          j.stage === 'done'
            ? s.openDoc(j.id)
            : j.stage === 'queued'
              ? s.startWizard(j.id)
              : s.startGenerating(j.id)
        }
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '8px 10px',
          borderRadius: 12,
          cursor: 'pointer',
          position: 'relative',
          background:
            s.currentJob === j.id && s.screen === 'doc' ? 'rgba(14,14,14,.06)' : 'transparent',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(14,14,14,.04)')}
        onMouseLeave={(e) =>
          (e.currentTarget.style.background =
            s.currentJob === j.id && s.screen === 'doc' ? 'rgba(14,14,14,.06)' : 'transparent')
        }
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: '#fff',
            border: '1px solid var(--hairline)',
            display: 'grid',
            placeItems: 'center',
            flex: 'none',
          }}
        >
          <Silhouette category={j.category} size={30} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {j.name}
          </div>
          <div className="mono" style={{ fontSize: 9.7, color: 'var(--tertiary)', marginTop: 2 }}>
            {j.article}
          </div>
        </div>
        <StatusChip stage={j.stage} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            setPackMenu(packMenu === j.id ? null : j.id);
          }}
          style={{
            border: 0,
            background: 'none',
            color: 'var(--secondary)',
            fontSize: 16,
            padding: '0 2px',
          }}
        >
          ⋮
        </button>
        {packMenu === j.id && (
          <Menu
            onClose={() => setPackMenu(null)}
            items={[
              {
                label: 'Переименовать',
                onClick: () => {
                  const name = prompt('Новое название', j.name);
                  if (!name?.trim()) return;
                  void api.meta(j.id, { name: name.trim() }).then(() => {
                    void s.refreshJobs();
                    s.showToast('Переименовано');
                  });
                },
              },
              {
                label: 'Дублировать',
                onClick: () =>
                  void api.duplicate(j.id).then(() => {
                    void s.refreshJobs();
                    s.showToast('Копия создана — откройте её из списка');
                  }),
              },
              {
                label: 'Взять за основу',
                onClick: () => s.startWizard(j.id),
              },
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
    );
  };

  return (
    <aside
      style={{
        width: 300,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(255,255,255,.48)',
        borderRight: '1px solid rgba(14,14,14,.08)',
        boxShadow: 'inset 0 1px 0 1px rgba(255,255,255,.7)',
        backdropFilter: 'blur(8px)',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Шапка */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '16px 16px 10px',
          position: 'relative',
        }}
      >
        <div
          onClick={() => s.go('home')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}
        >
          <Logo size={34} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Seamsterly</div>
            <div style={{ fontSize: 10.5, color: 'var(--secondary)' }}>Рабочая область</div>
          </div>
        </div>
        <button
          onClick={() => setNotifOpen(!notifOpen)}
          style={{ border: 0, background: 'none', position: 'relative', padding: 6 }}
          title="Уведомления"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#0E0E0E"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
          </svg>
          {s.jobs.some((j) => (j.assumptions ?? 0) > 0) && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 7,
                height: 7,
                borderRadius: 4,
                background: 'var(--data-red)',
              }}
            />
          )}
        </button>
        <button
          onClick={() => setCollapsed(true)}
          style={{ border: 0, background: 'none', padding: 6 }}
          title="Свернуть"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6B6B67"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        {notifOpen && (
          <div
            className="sfup"
            style={{
              position: 'absolute',
              top: '100%',
              left: 12,
              right: 12,
              zIndex: 50,
              background: '#fff',
              borderRadius: 12,
              boxShadow: 'var(--shadow-menu)',
              padding: 10,
            }}
          >
            {s.jobs
              .filter((j) => (j.assumptions ?? 0) > 0)
              .slice(0, 3)
              .map((j) => (
                <div
                  key={j.id}
                  onClick={() => {
                    setNotifOpen(false);
                    s.openDoc(j.id, 'pom');
                  }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 12.5,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(14,14,14,.04)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <b>{j.name}</b>: {j.assumptions} предположений ждут подтверждения →
                </div>
              ))}
            {!s.jobs.some((j) => (j.assumptions ?? 0) > 0) && (
              <div style={{ padding: 10, fontSize: 12.5, color: 'var(--secondary)' }}>
                Пока тихо.
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: '0 20px 8px', fontSize: 10.5, color: 'var(--secondary)' }}>
        Всего: {s.collections.length} коллекций, {s.jobs.length} паков
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 10px' }}>
        {/* Быстрые действия */}
        <SectionHead
          label="Быстрые действия"
          open={quickOpen}
          onToggle={() => setQuickOpen(!quickOpen)}
        />
        {quickOpen && (
          <div style={{ paddingBottom: 6 }}>
            {[
              { label: 'Новый техпак', act: () => s.startWizard() },
              { label: 'Технический чертёж', act: () => s.startWizard() },
              {
                label: '3D-рендер · скоро',
                act: () => s.showToast('3D-рендер в листе ожидания — записали интерес'),
              },
              {
                label: 'Примерка · скоро',
                act: () => s.showToast('Примерка в листе ожидания — записали интерес'),
              },
            ].map((q) => (
              <div
                key={q.label}
                onClick={() => {
                  q.act();
                  void api.event('quick_action', { label: q.label });
                }}
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                  color: q.label.includes('скоро') ? 'var(--secondary)' : 'var(--ink)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(14,14,14,.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                {q.label}
              </div>
            ))}
          </div>
        )}

        {/* Коллекции */}
        <SectionHead label="Коллекции" open onToggle={() => null} />
        {s.collections.map((c) => (
          <div key={c.name}>
            <div
              onClick={() => {
                const next = new Set(openCols);
                if (next.has(c.name)) next.delete(c.name);
                else next.add(c.name);
                setOpenCols(next);
              }}
              style={{
                padding: '7px 10px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              {c.name}
              <span style={{ color: 'var(--secondary)' }}>{c.packIds.length}</span>
            </div>
            {openCols.has(c.name) && (
              <div style={{ paddingLeft: 8 }}>
                {c.packIds.map(packRow)}
                <div
                  onClick={() => {
                    const free = single[0];
                    if (!free) return s.showToast('Все паки уже в коллекциях');
                    s.setCollections(
                      s.collections.map((x) =>
                        x.name === c.name ? { ...x, packIds: [...x.packIds, free.id] } : x,
                      ),
                    );
                  }}
                  style={{
                    padding: '6px 10px',
                    fontSize: 12,
                    color: 'var(--secondary)',
                    cursor: 'pointer',
                  }}
                >
                  добавить: {single[0]?.name ?? '—'}
                </div>
              </div>
            )}
          </div>
        ))}
        {colFormOpen ? (
          <div style={{ display: 'flex', gap: 6, padding: '4px 10px 8px' }}>
            <input
              autoFocus
              value={colName}
              onChange={(e) => setColName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && colName.trim()) {
                  s.setCollections([...s.collections, { name: colName.trim(), packIds: [] }]);
                  setColName('');
                  setColFormOpen(false);
                }
                if (e.key === 'Escape') setColFormOpen(false);
              }}
              placeholder="Название коллекции"
              style={{ flex: 1, fontSize: 12.5, padding: '6px 9px' }}
            />
          </div>
        ) : (
          <div
            onClick={() => setColFormOpen(true)}
            style={{
              padding: '6px 10px 10px',
              fontSize: 12.5,
              color: 'var(--secondary)',
              cursor: 'pointer',
            }}
          >
            + Новая коллекция
          </div>
        )}

        {/* Одиночные паки */}
        <SectionHead label="Одиночные паки" open onToggle={() => null} />
        {single.length ? (
          single.map((j) => packRow(j.id))
        ) : (
          <div style={{ padding: '4px 10px 10px', fontSize: 12.5, color: 'var(--secondary)' }}>
            Пока пусто — создайте первый техпак.
          </div>
        )}

        {/* Библиотека и тариф */}
        <div style={{ marginTop: 10, borderTop: '1px solid rgba(14,14,14,.07)', paddingTop: 8 }}>
          <div
            onClick={() => s.go('library')}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              fontWeight: s.screen === 'library' ? 700 : 400,
            }}
          >
            Библиотека бренда
            <span
              style={{
                fontSize: 10.5,
                color: s.profile.legal?.company ? 'var(--confirm-green)' : 'var(--data-red)',
              }}
            >
              {s.profile.legal?.company ? 'готово' : 'заполнить'}
            </span>
          </div>
          <div
            onClick={() => s.go('billing')}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: s.screen === 'billing' ? 700 : 400,
            }}
          >
            Тариф и кредиты
          </div>
        </div>
      </div>

      {/* Футер */}
      <div style={{ padding: 14, borderTop: '1px solid rgba(14,14,14,.07)', position: 'relative' }}>
        <div style={{ fontSize: 11.5, color: 'var(--secondary)', marginBottom: 6 }}>
          Баланс генераций{' '}
          <b style={{ color: 'var(--ink)' }}>
            {credits.used} из {credits.total}
          </b>
        </div>
        <div
          style={{
            height: 4,
            borderRadius: 99,
            background: 'rgba(14,14,14,.08)',
            marginBottom: 10,
          }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: 99,
              background: 'var(--ink)',
              width: `${(credits.used / credits.total) * 100}%`,
            }}
          />
        </div>
        <button
          className="btn"
          style={{ width: '100%', padding: '10px 0', fontSize: 13, marginBottom: 10 }}
          onClick={() => {
            s.showToast('Записали в лист ожидания тарифа «Студия»');
            void api.event('upgrade_click', null);
          }}
        >
          Увеличить лимит
        </button>
        <div
          onClick={() => setAccOpen(!accOpen)}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            cursor: 'pointer',
            padding: '6px 4px',
            borderRadius: 10,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              background: 'var(--ink)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {s.me.name.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.me.name}</div>
            <div style={{ fontSize: 10.5, color: 'var(--secondary)' }}>{s.me.org}</div>
          </div>
          <span style={{ color: 'var(--secondary)' }}>▾</span>
        </div>
        {accOpen && (
          <div
            className="sfup"
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 12,
              right: 12,
              marginBottom: 6,
              background: '#fff',
              borderRadius: 12,
              boxShadow: 'var(--shadow-menu)',
              padding: 8,
              zIndex: 50,
            }}
          >
            {['База знаний', 'Язык · Русский', 'Пригласить коллегу'].map((x) => (
              <div
                key={x}
                onClick={() => {
                  setAccOpen(false);
                  s.showToast(
                    x === 'Пригласить коллегу'
                      ? 'Попросите Данила создать инвайт — ссылка придёт вам'
                      : 'Скоро',
                  );
                }}
                style={{ padding: '8px 10px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(14,14,14,.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                {x}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function SectionHead({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className="kicker"
      style={{
        padding: '10px 10px 6px',
        fontSize: 9,
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
      }}
    >
      {label}
      <span style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }}>
        ▾
      </span>
    </div>
  );
}
