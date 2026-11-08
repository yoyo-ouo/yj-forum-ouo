#!/usr/bin/env node
/**
 * 校验 openapi.yaml 覆盖 handler 中注册的全部 /ov2/api 端点。
 * 路由来源：router.go（主注册）与 captcha.go（RegisterCaptchaRoutes 单独注册的 /captcha/*）。
 * 旧 /api/* 兼容层已移除，不再参与校验。
 * 用法：node scripts/check-api-docs.mjs（从 yj-forum-ouo 根目录运行）
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// 只扫真正注册 /ov2/api 路由的文件：新增 RegisterXxxRoutes 注册的文件时记得加到这里。
const routeFiles = [
  'server/internal/handler/router.go',
  'server/internal/handler/captcha.go',
];
const openapi = read('docs/api/openapi.yaml');

const re = /\bapi\.(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"/g;
const paths = new Set();
for (const file of routeFiles) {
  for (const m of read(file).matchAll(re)) paths.add('/ov2/api' + m[2]);
}

const toOas = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const missing = [...paths].filter((p) => !openapi.includes(`  ${toOas(p)}:`));

if (missing.length) {
  console.error(`[api-docs] ${missing.length} 个端点未出现在 openapi.yaml：`);
  for (const p of missing) console.error('  - ' + toOas(p));
  process.exit(1);
}
console.log(`[api-docs] OK：${paths.size} 个端点全部覆盖`);
