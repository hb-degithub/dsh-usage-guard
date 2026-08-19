/**
 * /usage-stats/* JSON API。金额读取侧现算；PUT 仅接受同源请求。
 */
import { dayOf } from './fold.js';
import { costOf, priceKey } from './pricing.js';

const tokensOf = (b) => b.input + b.output + b.cacheRead + b.cacheWrite;

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1_000_000) throw Object.assign(new Error('request body too large'), { statusCode: 413 });
  }
  return text;
}

/** 同源校验：Origin/Referer 的 host 必须等于 Host 头（无 Origin 的 GET 放行）。 */
function sameOrigin(req) {
  const source = req.headers.origin ?? req.headers.referer;
  if (source === undefined) return true;
  try {
    return new URL(source).host === req.headers.host;
  } catch {
    return false;
  }
}

/** 今日守卫状态。 */
export function guardStatus(store, today = dayOf(Date.now())) {
  const { guard, prices } = store.data.config;
  let todayTokens = 0;
  let todayCost = 0;
  let costKnown = true;
  for (const [key, b] of Object.entries(store.data.days)) {
    if (!key.startsWith(today + '|')) continue;
    todayTokens += tokensOf(b);
    const [_, provider, model] = key.split('|');
    const cost = costOf(b, prices[priceKey(provider, model)]);
    if (cost === null) costKnown = false;
    else todayCost += cost;
  }
  const reasons = [];
  if (guard.dailyTokens !== null && todayTokens > guard.dailyTokens) reasons.push(`今日 token 用量 ${todayTokens} 超过上限 ${guard.dailyTokens}`);
  if (guard.dailyCost !== null && costKnown && todayCost > guard.dailyCost) reasons.push(`今日费用 ${todayCost.toFixed(2)} 超过上限 ${guard.dailyCost}`);
  return { over: reasons.length > 0, reasons, todayTokens, todayCost: costKnown ? todayCost : null };
}

export function mountUsageRoutes(webServer, store) {
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://internal');
    const sub = url.pathname.replace(/^\/usage-stats\//, '').replace(/\/$/, '');
    try {
      if (req.method === 'GET' && sub === 'summary') {
        const days = Math.min(Number(url.searchParams.get('days') ?? 30) || 30, 366);
        return sendJson(res, 200, buildSummary(store, days));
      }
      if (req.method === 'GET' && sub === 'calendar') {
        const month = url.searchParams.get('month') ?? dayOf(Date.now()).slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) return sendJson(res, 400, { error: 'month must be YYYY-MM' });
        return sendJson(res, 200, buildCalendar(store, month));
      }
      if (req.method === 'GET' && sub === 'config') {
        return sendJson(res, 200, store.data.config);
      }
      if (req.method === 'PUT' && sub === 'config') {
        if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin writes are not allowed' });
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (error) {
          if (error?.statusCode) throw error; // 413 交给外层 catch
          return sendJson(res, 400, { error: 'invalid JSON body' });
        }
        try {
          store.setConfig(body);
        } catch (error) {
          return sendJson(res, 422, { error: error.message });
        }
        store.flush();
        return sendJson(res, 200, store.data.config);
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      sendJson(res, error.statusCode ?? 500, { error: String(error?.message ?? error) });
    }
  };
  return webServer.register({ kind: 'prefix', path: '/usage-stats/', handler });
}

/** 汇总：近 N 天序列 + 按模型 + 合计 + 今日 + 守卫。 */
export function buildSummary(store, days) {
  const { prices } = store.data.config;
  const byDay = new Map();
  const byModel = new Map();
  const unknown = new Set();
  let totalTokens = 0, totalCost = 0, totalRequests = 0, costKnown = true;
  for (const [key, b] of Object.entries(store.data.days)) {
    const [day, provider, model] = key.split('|');
    const cost = costOf(b, prices[priceKey(provider, model)]);
    if (cost === null) unknown.add(priceKey(provider, model));
    const tokens = tokensOf(b);
    const d = byDay.get(day) ?? { day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, tokens: 0, cost: 0 };
    d.input += b.input; d.output += b.output; d.cacheRead += b.cacheRead; d.cacheWrite += b.cacheWrite;
    d.requests += b.requests; d.tokens += tokens; if (cost !== null) d.cost += cost;
    byDay.set(day, d);
    const m = byModel.get(priceKey(provider, model)) ?? { provider, model, tokens: 0, cost: 0, requests: 0 };
    m.tokens += tokens; m.requests += b.requests; if (cost !== null) m.cost += cost;
    byModel.set(priceKey(provider, model), m);
    totalTokens += tokens; totalRequests += b.requests;
    if (cost === null) costKnown = false; else totalCost += cost;
  }
  const cutoff = dayOf(Date.now() - days * 86400_000);
  const series = [...byDay.values()].filter((d) => d.day >= cutoff).sort((a, b) => a.day.localeCompare(b.day));
  const models = [...byModel.values()].sort((a, b) => b.tokens - a.tokens)
    .map((m) => ({ ...m, cost: unknown.has(priceKey(m.provider, m.model)) ? null : m.cost }));
  const today = dayOf(Date.now());
  const t = byDay.get(today) ?? { day: today, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, tokens: 0, cost: 0 };
  return {
    today: { ...t, cost: unknownPriceInDay(store, today) ? null : t.cost },
    series: series.map((d) => ({ ...d, cost: unknownPriceInDay(store, d.day) ? null : d.cost })),
    byModel: models,
    totals: { tokens: totalTokens, cost: costKnown ? totalCost : null, requests: totalRequests },
    unknownPriceModels: [...unknown],
    guard: guardStatus(store, today),
  };
}

function unknownPriceInDay(store, day) {
  const { prices } = store.data.config;
  return Object.keys(store.data.days).some((key) => {
    if (!key.startsWith(day + '|')) return false;
    const [_, provider, model] = key.split('|');
    return prices[priceKey(provider, model)] === undefined;
  });
}

/** 日历：某月逐日 { tokens, cost, requests }。 */
export function buildCalendar(store, month) {
  const { prices } = store.data.config;
  const days = {};
  for (const [key, b] of Object.entries(store.data.days)) {
    const [day, provider, model] = key.split('|');
    if (!day.startsWith(month + '-')) continue;
    const cell = days[day] ?? { tokens: 0, cost: 0, requests: 0, costKnown: true };
    cell.tokens += tokensOf(b);
    cell.requests += b.requests;
    const cost = costOf(b, prices[priceKey(provider, model)]);
    if (cost === null) cell.costKnown = false; else cell.cost += cost;
    days[day] = cell;
  }
  for (const cell of Object.values(days)) {
    if (!cell.costKnown) cell.cost = null;
    delete cell.costKnown;
  }
  return { days };
}
