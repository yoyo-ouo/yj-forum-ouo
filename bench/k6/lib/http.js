import http from 'k6/http';

// 基准 API 根地址（默认指向独立的 bench server :8091）。
export const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8091/ov2/api';
export const ORIGIN = __ENV.ORIGIN || 'http://127.0.0.1:8091';

export function headers(token) {
  const h = {
    'Accept': 'application/json',
    // CSRF 中间件校验 Origin/Referer，必须与 Host 一致
    'Origin': ORIGIN,
    'User-Agent': 'k6-bench/1.0',
  };
  if (token) h['Cookie'] = `forum_session=${token}`;
  return h;
}

export function get(path, token, tags) {
  return http.get(BASE + path, { headers: headers(token), tags: tags || {} });
}

export function getRoot(path, tags) {
  return http.get(ORIGIN + path, { tags: tags || {} });
}

export function postJSON(path, body, token, tags) {
  const h = headers(token);
  h['Content-Type'] = 'application/json';
  return http.post(BASE + path, JSON.stringify(body), { headers: h, tags: tags || {} });
}

export function postMultipart(path, formData, token, tags) {
  return http.post(BASE + path, formData, { headers: headers(token), tags: tags || {} });
}

export function ok(res) {
  return res.status >= 200 && res.status < 400;
}
