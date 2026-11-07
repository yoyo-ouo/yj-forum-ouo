import { get } from '../lib/http.js';
import { DATA, rand } from '../lib/data.js';
import { handleSummary, arrivalOptions } from '../lib/summary.js';

export const options = arrivalOptions('search', 20, '45s', 20, 80);

export default function () {
  const r = Math.random();
  if (r < 0.70) {
    get('/search?k=' + encodeURIComponent(rand(DATA.search_terms)), null, { endpoint: 'search_posts' });
  } else if (r < 0.90) {
    get('/search?k=' + encodeURIComponent(rand(DATA.search_terms)) + '&type=users', null, { endpoint: 'search_users' });
  } else {
    get('/articles/search?k=' + encodeURIComponent(rand(DATA.search_terms)), null, { endpoint: 'search_articles' });
  }
}

export { handleSummary };
