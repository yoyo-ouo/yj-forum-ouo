import { check } from 'k6';
import { get, getRoot, ok } from '../lib/http.js';
import { DATA, rand, tokenForVU } from '../lib/data.js';
import { handleSummary } from '../lib/summary.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { http_req_failed: ['rate==0'] },
};

export default function () {
  const token = tokenForVU(1);
  const pid = rand(DATA.post_ids);
  const hot = rand(DATA.hot_post_ids);

  check(getRoot('/healthz'), { 'healthz 200': (r) => r.status === 200 });
  check(getRoot('/debug/metrics'), {
    'debug/metrics 200': (r) => r.status === 200,
    'debug/metrics 含 runtime': (r) => r.body && r.body.indexOf('"runtime"') >= 0,
  });
  check(get('/feed'), { 'feed 200': (r) => r.status === 200 && r.body.length > 0 });
  check(get('/posts?page=1&page_size=20'), { 'posts 200': (r) => r.status === 200 });
  check(get('/posts/' + pid), { 'post detail 200': (r) => r.status === 200 });
  check(get('/posts/' + hot + '/comments?limit=50'), { 'comments 200': (r) => r.status === 200 });
  check(get('/search?k=' + encodeURIComponent('星海')), { 'search 200': (r) => r.status === 200 });
  check(get('/articles/search?k=' + encodeURIComponent('星海')), { 'article search 200': (r) => r.status === 200 });
  check(get('/guilds'), { 'guilds 200': (r) => r.status === 200 });
  check(get('/guilds/' + rand(DATA.guild_slugs)), { 'guild detail 200': (r) => r.status === 200 });
  check(get('/guilds/' + rand(DATA.guild_slugs) + '/feed'), { 'guild feed 200': (r) => r.status === 200 });
  check(get('/users/' + rand(DATA.user_ids)), { 'user profile 200': (r) => r.status === 200 });
  check(get('/guides'), { 'guides 200': (r) => r.status === 200 });
  check(get('/guides/' + rand(DATA.guide_ids)), { 'guide detail 200': (r) => r.status === 200 });
  check(get('/articles/' + rand(DATA.article_ids)), { 'article detail 200': (r) => r.status === 200 });
  check(get('/media/' + rand(DATA.media_ids)), { 'media 200': (r) => r.status === 200 });
  check(get('/users/me', token), { 'users/me 200': (r) => r.status === 200 });
  check(get('/users/' + rand(DATA.user_ids) + '/mutual', token), { 'mutual 200': (r) => r.status === 200 });
}

export { handleSummary };
