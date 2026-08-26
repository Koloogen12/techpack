import { useState } from 'react';
import { useStore } from './store.js';
import { Kicker } from './ui.js';

/**
 * Библиотека бренда — хендофф, экран 9: материалы, размерная сетка,
 * юрданные, логотип. Юрданные РЕАЛЬНО каскадируют: сервер подмешивает их
 * в анкету следующей генерации, и ярлыки перестают быть пробелами.
 */
export function Library() {
  const s = useStore();
  const [legalOpen, setLegalOpen] = useState(false);
  const [legal, setLegal] = useState({
    company: s.profile.legal?.company ?? '',
    inn: s.profile.legal?.inn ?? '',
    address: s.profile.legal?.address ?? '',
  });
  const [matFormOpen, setMatFormOpen] = useState(false);
  const [mat, setMat] = useState({ name: '', spec: '', hex: '#0E0E0E', pantone: '' });

  const saveLegal = async () => {
    if (!legal.company.trim()) return s.showToast('Название компании обязательно');
    await s.saveProfile({ ...s.profile, legal });
    setLegalOpen(false);
    s.showToast('Юрданные сохранены — уйдут в ярлыки следующей генерации');
  };

  const addMaterial = async () => {
    if (!mat.name.trim()) return s.showToast('У материала должно быть имя');
    await s.saveProfile({ ...s.profile, materials: [...(s.profile.materials ?? []), mat] });
    setMat({ name: '', spec: '', hex: '#0E0E0E', pantone: '' });
    setMatFormOpen(false);
    s.showToast('Материал добавлен в библиотеку');
  };

  return (
    <div className="sfup" style={{ maxWidth: 880, margin: '0 auto', padding: '48px 32px' }}>
      <h1 style={{ fontSize: 28, letterSpacing: '-0.5px', margin: '0 0 6px' }}>
        Библиотека бренда
      </h1>
      <div style={{ color: 'var(--secondary)', marginBottom: 28, maxWidth: 560, lineHeight: 1.6 }}>
        Заполняется один раз и работает во всех паках: юрданные уходят в ярлыки, материалы — в
        спецификацию.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Юрданные */}
        <div className="card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b style={{ fontSize: 15 }}>Юрданные</b>
            {s.profile.legal?.company ? (
              <span style={{ fontSize: 11, color: 'var(--confirm-green)', fontWeight: 600 }}>
                ✓ готово
              </span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--data-red)', fontWeight: 600 }}>
                заполнить
              </span>
            )}
          </div>
          {!legalOpen && s.profile.legal?.company ? (
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7 }}>
              <div>
                <b>{s.profile.legal.company}</b>
              </div>
              <div className="mono" style={{ fontSize: 11 }}>
                ИНН {s.profile.legal.inn || '—'}
              </div>
              <div style={{ color: 'var(--secondary)' }}>{s.profile.legal.address || '—'}</div>
              <button className="chip" style={{ marginTop: 10 }} onClick={() => setLegalOpen(true)}>
                Изменить
              </button>
            </div>
          ) : legalOpen || !s.profile.legal?.company ? (
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--secondary)', lineHeight: 1.55 }}>
                Обязательные реквизиты ярлыка по ТР ТС: изготовитель, адрес. Без них продажа в ЕАЭС
                невозможна.
              </div>
              {(
                [
                  ['company', 'Компания-изготовитель'],
                  ['inn', 'ИНН'],
                  ['address', 'Юридический адрес'],
                ] as const
              ).map(([k, label]) => (
                <label key={k}>
                  <Kicker style={{ fontSize: 8.3, marginBottom: 4 }}>{label}</Kicker>
                  <input
                    style={{ width: '100%' }}
                    value={legal[k]}
                    onChange={(e) => setLegal({ ...legal, [k]: e.target.value })}
                  />
                </label>
              ))}
              <button
                className="btn"
                style={{ padding: '10px 18px', fontSize: 13 }}
                onClick={() => void saveLegal()}
              >
                Сохранить
              </button>
            </div>
          ) : null}
        </div>

        {/* Материалы */}
        <div className="card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b style={{ fontSize: 15 }}>Материалы</b>
            <span style={{ fontSize: 11, color: 'var(--secondary)' }}>
              {s.profile.materials?.length ?? 0}
            </span>
          </div>
          {(s.profile.materials ?? []).map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                padding: '9px 0',
                borderBottom: '1px solid var(--hairline-row)',
                fontSize: 13,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 5,
                  background: m.hex,
                  border: '1px solid rgba(0,0,0,.15)',
                }}
              />
              <b>{m.name}</b>
              <span style={{ color: 'var(--secondary)', fontSize: 12 }}>{m.spec}</span>
              {m.pantone && (
                <span className="mono" style={{ fontSize: 10, color: 'var(--tertiary)' }}>
                  {m.pantone}
                </span>
              )}
            </div>
          ))}
          {matFormOpen ? (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <input
                placeholder="Название — Футер 3-нитка петля"
                value={mat.name}
                onChange={(e) => setMat({ ...mat, name: e.target.value })}
              />
              <input
                placeholder="Состав и плотность — 80/20, 320 г/м²"
                value={mat.spec}
                onChange={(e) => setMat({ ...mat, spec: e.target.value })}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="color"
                  value={mat.hex}
                  onChange={(e) => setMat({ ...mat, hex: e.target.value })}
                  style={{ width: 46, padding: 3, height: 38 }}
                />
                <input
                  placeholder="Номер цвета бренда (Pantone и т. п.)"
                  value={mat.pantone}
                  onChange={(e) => setMat({ ...mat, pantone: e.target.value })}
                  style={{ flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn"
                  style={{ padding: '9px 16px', fontSize: 12.5 }}
                  onClick={() => void addMaterial()}
                >
                  Добавить
                </button>
                <button
                  className="btn white"
                  style={{ padding: '9px 16px', fontSize: 12.5 }}
                  onClick={() => setMatFormOpen(false)}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button className="chip" style={{ marginTop: 12 }} onClick={() => setMatFormOpen(true)}>
              + Добавить материал
            </button>
          )}
        </div>

        {/* Размерная сетка */}
        <div className="card" style={{ padding: '20px 22px' }}>
          <b style={{ fontSize: 15 }}>Размерная сетка</b>
          <div
            style={{ marginTop: 10, fontSize: 12.5, color: 'var(--secondary)', lineHeight: 1.6 }}
          >
            Сейчас работает сетка ГОСТ 31396/31399 — обхваты тела по российским размерам. Своя сетка
            бренда подключается файлом: пришлите таблицу, и градация пойдёт по ней.
          </div>
          <button
            className="chip"
            style={{ marginTop: 12 }}
            onClick={() => s.showToast('Записали: пришлите сетку — подключим в течение дня')}
          >
            Загрузить свою сетку
          </button>
        </div>

        {/* Логотип */}
        <div className="card" style={{ padding: '20px 22px' }}>
          <b style={{ fontSize: 15 }}>Логотип</b>
          <div
            style={{ marginTop: 10, fontSize: 12.5, color: 'var(--secondary)', lineHeight: 1.6 }}
          >
            Ложится в мастхед документа: пак показывается фабрике от имени бренда, Seamsterly живёт
            в футере.
          </div>
          <button
            className="chip"
            style={{ marginTop: 12 }}
            onClick={() => s.showToast('Записали: пришлите SVG или PNG — поставим в мастхед')}
          >
            Загрузить логотип
          </button>
        </div>
      </div>
    </div>
  );
}

/** Тариф и кредиты — хендофф, экран 10. */
export function Billing() {
  const s = useStore();
  const used = Math.min(s.jobs.length, 3);
  return (
    <div className="sfup" style={{ maxWidth: 760, margin: '0 auto', padding: '48px 32px' }}>
      <h1 style={{ fontSize: 28, letterSpacing: '-0.5px', margin: '0 0 22px' }}>Тариф и кредиты</h1>

      <div className="card" style={{ padding: '24px 28px', marginBottom: 18 }}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>
          {used} из 3{' '}
          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--secondary)' }}>
            генераций в бете
          </span>
        </div>
        <div
          style={{
            height: 5,
            borderRadius: 99,
            background: 'rgba(14,14,14,.08)',
            margin: '12px 0 0',
          }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: 99,
              background: 'var(--ink)',
              width: `${(used / 3) * 100}%`,
            }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
        <div className="panel" style={{ padding: '20px 22px' }}>
          <b>Бесплатный</b>
          <div
            style={{ fontSize: 12.5, color: 'var(--secondary)', margin: '8px 0', lineHeight: 1.7 }}
          >
            3 техпака в месяц · PDF полный · чертёж и градация · три языка
          </div>
          <span className="chip on" style={{ fontSize: 11.5 }}>
            текущий
          </span>
        </div>
        <div className="panel" style={{ padding: '20px 22px', borderColor: 'var(--ink)' }}>
          <b>Студия</b>
          <div
            style={{ fontSize: 12.5, color: 'var(--secondary)', margin: '8px 0', lineHeight: 1.7 }}
          >
            Безлимит генераций · выгрузки по ролям · версии и примерки · приоритетная очередь
          </div>
          <button
            className="btn"
            style={{ padding: '9px 16px', fontSize: 12.5 }}
            onClick={() => s.showToast('Записали в лист ожидания «Студии»')}
          >
            Перейти на Студию
          </button>
        </div>
      </div>

      <div
        style={{
          borderRadius: 12,
          padding: '16px 20px',
          fontSize: 13,
          lineHeight: 1.6,
          background: '#D9F2E3',
          border: '1px solid #9FD8B6',
          color: '#0D4F2B',
        }}
      >
        <b>Производство через платформу — безлимит генераций.</b> Разместите заказ на просчёт через
        нас, и генерации перестанут считаться вовсе.
      </div>
    </div>
  );
}
