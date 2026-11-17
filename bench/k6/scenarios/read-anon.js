import { get } from '../lib/http.js';
import { DATA, rand } from '../lib/data.js';
import { handleSummary, arrivalOptions } from '../lib/summary.js';

export const options = arrivalOptions('read-anon', 300, '60s', 50, 200);

export default function () {
  const r = Math.random();
  if (r < 0.26) {
    get('/feed', null, { endpoint: 'feed' });
  } else if (r < 0.50) {
    get('/posts?page=' + (1 + Math.floor(Math.random() * 3)) + '&page_size=20', null, { endpoint: 'post_list' });
  } else if (r < 0.70) {
    get('/posts/' + rand(DATA.post_ids), null, { endpoint: 'post_detail' });
  } else if (r < 0.82) {
    get('/posts/' + rand(DATA.hot_post_ids) + '/comments?limit=50', null, { endpoint: 'comments' });
  } else if (r < 0.88) {
    get('/guilds', null, { endpoint: 'guild_list' });
  } else if (r < 0.92) {
    get('/guilds/' + rand(DATA.guild_slugs), null, { endpoint: 'guild_detail' });
  } else if (r < 0.95) {
    get('/guilds/' + rand(DATA.guild_slugs) + '/feed', null, { endpoint: 'guild_feed' });
  } else if (r < 0.97) {
    get('/guides', null, { endpoint: 'guide_list' });
  } else if (r < 0.99) {
    get('/guides/' + rand(DATA.guide_ids), null, { endpoint: 'guide_detail' });
  } else {
    get('/articles/' + rand(DATA.article_ids), null, { endpoint: 'article_detail' });
  }
}

export { handleSummary };
