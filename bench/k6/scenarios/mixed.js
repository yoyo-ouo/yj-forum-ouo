import http from 'k6/http';
import { get, postJSON, postMultipart } from '../lib/http.js';
import { DATA, rand, tokenForVU } from '../lib/data.js';
import { handleSummary, arrivalOptions } from '../lib/summary.js';

const imageBytes = open(__ENV.IMAGE_FILE || '../../assets/bench.jpg', 'b');

export const options = arrivalOptions('mixed', 250, '90s', 60, 250);

export default function () {
  const token = tokenForVU(__VU);
  const r = Math.random();
  if (r < 0.30) {
    get('/feed', null, { endpoint: 'feed' });
  } else if (r < 0.45) {
    get('/posts/' + rand(DATA.post_ids), null, { endpoint: 'post_detail' });
  } else if (r < 0.55) {
    get('/posts/' + rand(DATA.hot_post_ids) + '/comments?limit=50', null, { endpoint: 'comments' });
  } else if (r < 0.62) {
    get('/posts?page=' + (1 + Math.floor(Math.random() * 3)), null, { endpoint: 'post_list' });
  } else if (r < 0.70) {
    get('/search?k=' + encodeURIComponent(rand(DATA.search_terms)), null, { endpoint: 'search_posts' });
  } else if (r < 0.78) {
    get('/users/me', token, { endpoint: 'me' });
  } else if (r < 0.86) {
    get('/users/' + rand(DATA.user_ids), token, { endpoint: 'user_profile' });
  } else if (r < 0.91) {
    get('/guilds/' + rand(DATA.guild_slugs), null, { endpoint: 'guild_detail' });
  } else if (r < 0.96) {
    postJSON('/posts/' + rand(DATA.post_ids) + '/like', {}, token, { endpoint: 'like_post' });
  } else if (r < 0.99) {
    postJSON('/posts/' + rand(DATA.post_ids) + '/comments', {
      content: '<p>混合流量评论 ' + Date.now() + '</p>',
    }, token, { endpoint: 'create_comment' });
  } else {
    postMultipart('/media/images', { file: http.file(imageBytes, 'bench.jpg', 'image/jpeg'), scene: 'post_image' }, token, { endpoint: 'upload' });
  }
}

export { handleSummary };
