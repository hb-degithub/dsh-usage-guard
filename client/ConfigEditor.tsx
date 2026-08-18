import { useState } from 'react';
import type { Config, Price } from './api.ts';
import { putConfig } from './api.ts';

const fields: (keyof Price)[] = ['input', 'output', 'cacheRead', 'cacheWrite'];

/** 价格表 + 守卫设置编辑器。 */
export function ConfigEditor({ config, t, onSaved }: { config: Config; t: (k: string) => string; onSaved: (c: Config) => void }) {
  const [draft, setDraft] = useState<Config>(config);
  const [saved, setSaved] = useState(false);

  const setPrice = (key: string, field: keyof Price, value: string) => {
    setDraft({ ...draft, prices: { ...draft.prices, [key]: { ...draft.prices[key], [field]: field === 'currency' ? value : Number(value) || 0 } } });
  };
  const setGuard = (field: 'dailyTokens' | 'dailyCost' | 'mode', value: string) => {
    const v = field === 'mode' ? value : (value === '' ? null : Number(value));
    setDraft({ ...draft, guard: { ...draft.guard, [field]: v } });
  };
  const save = async () => {
    onSaved(await putConfig(draft));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const inputStyle = { width: 72 } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <h4>{t('pricing')}</h4>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr><th style={{ textAlign: 'left' }}>{t('providerModel')}</th>{fields.map((f) => <th key={f}>{f}</th>)}<th>currency</th></tr></thead>
          <tbody>
            {Object.entries(draft.prices).map(([key, price]) => (
              <tr key={key}>
                <td style={{ paddingRight: 8 }}>{key}</td>
                {fields.map((f) => (
                  <td key={f}><input style={inputStyle} type="number" min="0" step="0.01" value={price[f]} onChange={(e) => setPrice(key, f, e.target.value)} /></td>
                ))}
                <td><input style={{ width: 56 }} value={price.currency} onChange={(e) => setPrice(key, 'currency', e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 11, opacity: 0.7 }}>{t('currencyNote')}</p>
      </section>
      <section>
        <h4>{t('guard')}</h4>
        <label style={{ display: 'block', fontSize: 12 }}>{t('dailyTokens')}:
          <input style={inputStyle} type="number" min="0" value={draft.guard.dailyTokens ?? ''} onChange={(e) => setGuard('dailyTokens', e.target.value)} /></label>
        <label style={{ display: 'block', fontSize: 12 }}>{t('dailyCost')}:
          <input style={inputStyle} type="number" min="0" step="0.01" value={draft.guard.dailyCost ?? ''} onChange={(e) => setGuard('dailyCost', e.target.value)} /></label>
        <label style={{ display: 'block', fontSize: 12 }}>{t('mode')}:
          <select value={draft.guard.mode} onChange={(e) => setGuard('mode', e.target.value)}>
            <option value="warn">{t('warn')}</option>
            <option value="block">{t('block')}</option>
          </select></label>
      </section>
      <button onClick={save} style={{ alignSelf: 'flex-start' }}>{saved ? t('saved') : t('save')}</button>
    </div>
  );
}
