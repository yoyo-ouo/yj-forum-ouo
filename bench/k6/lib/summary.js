// 统一的 k6 结果导出：写入 SUMMARY_OUT 指定的 JSON 文件。
export function handleSummary(data) {
  const out = __ENV.SUMMARY_OUT;
  if (out) {
    return { [out]: JSON.stringify(data, null, 2) };
  }
  return { stdout: '' };
}

// arrivalOptions 生成固定到达率（open model）场景配置，避免 coordinated omission。
export function arrivalOptions(name, defRate, defDuration, defPreVUs, defMaxVUs) {
  const scenario = {};
  scenario[name] = {
    executor: 'constant-arrival-rate',
    rate: Number(__ENV.RATE || defRate),
    timeUnit: '1s',
    duration: __ENV.DURATION || defDuration,
    preAllocatedVUs: Number(__ENV.PRE_VUS || defPreVUs),
    maxVUs: Number(__ENV.MAX_VUS || defMaxVUs),
    gracefulStop: '5s',
  };
  return {
    scenarios: scenario,
    discardResponseBodies: false,
    summaryTrendStats: ['avg', 'min', 'med', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  };
}
