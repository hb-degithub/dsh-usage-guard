/** 价格表：每 1M tokens 的货币单位。默认值为 DeepSeek 官方刊例（以官网为准，用户可在面板修改）。 */
export const DEFAULT_PRICES = {
  'deepseek/deepseek-chat': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2, currency: 'CNY' },
  'deepseek/deepseek-reasoner': { input: 4, output: 16, cacheRead: 1, cacheWrite: 4, currency: 'CNY' },
};

export const priceKey = (provider, model) => `${provider}/${model}`;

/** 一桶用量的费用；无价格返回 null（未知，不参与合计）。 */
export function costOf(buckets, price) {
  if (!price) return null;
  return (buckets.input * price.input
    + buckets.output * price.output
    + buckets.cacheRead * price.cacheRead
    + buckets.cacheWrite * price.cacheWrite) / 1e6;
}
