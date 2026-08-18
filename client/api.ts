export interface Buckets { input: number; output: number; cacheRead: number; cacheWrite: number; requests: number }
export interface DayRow extends Buckets { day: string; tokens: number; cost: number | null }
export interface ModelRow { provider: string; model: string; tokens: number; cost: number | null; requests: number }
export interface GuardStatus { over: boolean; reasons: string[]; todayTokens: number; todayCost: number | null }
export interface Summary {
  today: DayRow;
  series: DayRow[];
  byModel: ModelRow[];
  totals: { tokens: number; cost: number | null; requests: number };
  unknownPriceModels: string[];
  guard: GuardStatus;
}
export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number; currency: string }
export interface Config { prices: Record<string, Price>; guard: { dailyTokens: number | null; dailyCost: number | null; mode: 'warn' | 'block' } }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

export const fetchSummary = () => get<Summary>('/usage-stats/summary?days=30');
export const fetchCalendar = (month: string) => get<{ days: Record<string, { tokens: number; cost: number | null; requests: number }> }>(`/usage-stats/calendar?month=${month}`);
export const fetchConfig = () => get<Config>('/usage-stats/config');
export async function putConfig(config: Config): Promise<Config> {
  const r = await fetch('/usage-stats/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) });
  if (!r.ok) throw new Error(`PUT config -> ${r.status}`);
  return r.json() as Promise<Config>;
}
