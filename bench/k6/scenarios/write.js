import { postJSON } from '../lib/http.js';
import { DATA, rand, tokenForVU } from '../lib/data.js';
import { handleSummary, arrivalOptions } from '../lib/summary.js';

export const options = arrivalOptions('write', 30, '45s', 20, 80);

export default function () {
  const token = tokenForVU(__VU);
  const r = Math.random();
  const stamp = Date.now() + '-' + Math.floor(Math.random() * 100000);
  if (r < 0.22) {
    postJSON('/posts', {
      title: '基准压测帖 ' + stamp,
      content: '<p>基准压测正文 ' + stamp + '：灵质空间与星海。</p>',
      category: 'general',
    }, token, { endpoint: 'create_post' });
  } else if (r < 0.52) {
    postJSON('/posts/' + rand(DATA.post_ids) + '/comments', {
      content: '<p>基准压测评论 ' + stamp + '</p>',
    }, token, { endpoint: 'create_comment' });
  } else if (r < 0.74) {
    postJSON('/posts/' + rand(DATA.post_ids) + '/like', {}, token, { endpoint: 'like_post' });
  } else if (r < 0.90) {
    postJSON('/posts/' + rand(DATA.post_ids) + '/favorite', {}, token, { endpoint: 'favorite_post' });
  } else {
    postJSON('/comments/' + rand(DATA.comment_ids) + '/like', {}, token, { endpoint: 'like_comment' });
  }
}

export { handleSummary };
