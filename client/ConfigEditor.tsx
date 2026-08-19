import { useState } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Config, Price } from './api.ts';
import { putConfig } from './api.ts';
import css from './Panel.module.css';

const fields: { key: keyof Price; label: string }[] = [
  { key: 'input', label: 'input' },
  { key: 'output', label: 'output' },
  { key: 'cacheRead', label: 'cacheRead' },
  { key: 'cacheWrite', label: 'cacheWrite' },
];

/** 价格表 + 守卫设置编辑器。 */
export function ConfigEditor({ config, t, onSaved }: { config: Config; t: (k: string) => string; onSaved: (c: Config) => void }) {
  const [draft, setDraft] = useState<Config>(config);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [newKey, setNewKey] = useState('');
  const [addHint, setAddHint] = useState('');

  const setPrice = (key: string, field: keyof Price, value: string) => {
    setDraft({ ...draft, prices: { ...draft.prices, [key]: { ...draft.prices[key], [field]: field === 'currency' ? value : Number(value) || 0 } } });
  };
  const addPrice = () => {
    const key = newKey.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(key)) { setAddHint(t('priceKeyInvalid')); return; }
    if (draft.prices[key] !== undefined) { setAddHint(t('priceKeyDuplicate')); return; }
    setAddHint('');
    setNewKey('');
    setDraft({ ...draft, prices: { ...draft.prices, [key]: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, currency: 'CNY' } } });
  };
  const removePrice = (key: string) => {
    const prices = { ...draft.prices };
    delete prices[key];
    setDraft({ ...draft, prices });
  };
  const setGuard = (field: 'dailyTokens' | 'dailyCost' | 'mode', value: string) => {
    const v = field === 'mode' ? value : (value === '' ? null : Number(value));
    setDraft({ ...draft, guard: { ...draft.guard, [field]: v } });
  };
  const save = async () => {
    setSaveError('');
    try {
      onSaved(await putConfig(draft));
    } catch (error) {
      setSaveError(String((error as Error)?.message ?? error));
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 className={css.secTitle}>{t('pricing')}</h3>
        <table className={css.tbl}>
          <thead>
            <tr>
              <th>{t('providerModel')}</th>
              {fields.map((f) => <th key={f.key} className={css.num}>{f.label}</th>)}
              <th>currency</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(draft.prices).map(([key, price]) => (
              <tr key={key}>
                <td className={css.mono}>{key}</td>
                {fields.map((f) => (
                  <td key={f.key} className={css.num}>
                    <Input className={css.numInput} type="number" min="0" step="0.01" value={price[f.key]}
                      onChange={(e) => setPrice(key, f.key, e.target.value)} />
                  </td>
                ))}
                <td>
                  <Input className={css.curInput} value={price.currency} onChange={(e) => setPrice(key, 'currency', e.target.value)} />
                </td>
                <td className={css.num}>
                  <Button variant="outline" size="sm" onClick={() => removePrice(key)}>{t('remove')}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={css.addRow}>
          <Input className={css.keyInput} placeholder="provider/model" value={newKey}
            onChange={(e) => { setNewKey(e.target.value); setAddHint(''); }} />
          <Button variant="outline" size="sm" onClick={addPrice}>{t('add')}</Button>
          {addHint !== '' && <span className={css.err}>{addHint}</span>}
        </div>
        <p className={css.note}>{t('currencyNote')}</p>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 className={css.secTitle}>{t('guard')}</h3>
        <div className={css.formRow}>
          <span className={css.formLabel}>{t('dailyTokens')}</span>
          <Input className={css.numInput} type="number" min="0" value={draft.guard.dailyTokens ?? ''}
            onChange={(e) => setGuard('dailyTokens', e.target.value)} />
        </div>
        <div className={css.formRow}>
          <span className={css.formLabel}>{t('dailyCost')}</span>
          <Input className={css.numInput} type="number" min="0" step="0.01" value={draft.guard.dailyCost ?? ''}
            onChange={(e) => setGuard('dailyCost', e.target.value)} />
        </div>
        <div className={css.formRow}>
          <span className={css.formLabel}>{t('mode')}</span>
          <select className={css.sel} value={draft.guard.mode} onChange={(e) => setGuard('mode', e.target.value)}>
            <option value="warn">{t('warn')}</option>
            <option value="block">{t('block')}</option>
          </select>
        </div>
      </section>

      <div className={css.saveRow}>
        <Button variant="primary" size="sm" onClick={save}>{t('save')}</Button>
        {saved && <span className={css.okState}>{t('saved')} ✓</span>}
        {saveError !== '' && <span className={css.err}>{saveError}</span>}
      </div>
    </div>
  );
}
