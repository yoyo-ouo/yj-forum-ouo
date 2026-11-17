import { get } from '../lib/http.js';
import { DATA, rand } from '../lib/data.js';
import { handleSummary, arrivalOptions } from '../lib/summary.js';

// 容量阶梯测试：固定到达率，由编排脚本逐步抬高 RATE，找 p95 拐点。
export const options = arrivalOptions('capacity', 200, '20s', 100, 800);

export default function () {
  const r = Math.random();
  if (r < 0.34) {
    get('/feed', null, { endpoint: 'feed' });
  } else if (r < 0.60) {
    get('/posts/' + rand(DATA.post_ids), null, { endpoint: 'post_detail' });
  } else if (r < 0.74) {
    get('/posts/' + rand(DATA.hot_post_ids) + '/comments?limit=50', null, { endpoint: 'comments' });
  } else if (r < 0.84) {
    get('/posts?page=1&page_size=20', null, { endpoint: 'post_list' });
  } else if (r < 0.92) {
    get('/users/' + rand(DATA.user_ids), null, { endpoint: 'user_profile' });
  } else if (r < 0.97) {
    get('/guilds/' + rand(DATA.guild_slugs), null, { endpoint: 'guild_detail' });
  } else {
    get('/search?k=' + encodeURIComponent(rand(DATA.search_terms)), null, { endpoint: 'search_posts' });
  }
}

export { handleSummary };
