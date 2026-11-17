// IDS_FILE 由编排脚本注入（绝对路径），默认回退到 bench/seed/ids.json。
const path = __ENV.IDS_FILE || '../../seed/ids.json';
export const DATA = JSON.parse(open(path));

export function rand(arr) {
  if (!arr || arr.length === 0) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pick(arr, i) {
  if (!arr || arr.length === 0) return '';
  return arr[i % arr.length];
}

export function tokenForVU(vu) {
  return pick(DATA.tokens, vu - 1);
}
