import { get } from '../lib/http.js';
import { DATA, rand, tokenForVU } from '../lib/data.js';
import { handleSummary, arrivalOptions } from '../lib/summary.js';

export const options = arrivalOptions('read-auth', 120, '45s', 30, 120);

export default function () {
  const token = tokenForVU(__VU);
  const uid = rand(DATA.user_ids);
  const r = Math.random();
  if (r < 0.24) {
    get('/users/me', token, { endpoint: 'me' });
  } else if (r < 0.44) {
    get('/users/' + uid, token, { endpoint: 'user_profile' });
  } else if (r < 0.60) {
    get('/users/' + uid + '/posts', token, { endpoint: 'user_posts' });
  } else if (r < 0.72) {
    get('/users/' + uid + '/favorites', token, { endpoint: 'user_favorites' });
  } else if (r < 0.84) {
    get('/users/me/replies', token, { endpoint: 'my_replies' });
  } else if (r < 0.94) {
    get('/users/' + uid + '/mutual', token, { endpoint: 'mutual' });
  } else {
    get('/users/' + uid + '/following', token, { endpoint: 'following' });
  }
}

export { handleSummary };
