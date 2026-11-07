import http from 'k6/http';
import { postMultipart, get } from '../lib/http.js';
import { DATA, rand, tokenForVU } from '../lib/data.js';
import { handleSummary, arrivalOptions } from '../lib/summary.js';

const imagePath = __ENV.IMAGE_FILE || '../../assets/bench.jpg';
const imageBytes = open(imagePath, 'b');

export const options = arrivalOptions('media', 20, '30s', 10, 40);

export default function () {
  const token = tokenForVU(__VU);
  if (Math.random() < 0.5) {
    const form = {
      file: http.file(imageBytes, 'bench.jpg', 'image/jpeg'),
      scene: 'post_image',
    };
    postMultipart('/media/images', form, token, { endpoint: 'upload' });
  } else {
    get('/media/' + rand(DATA.media_ids), null, { endpoint: 'media_read' });
  }
}

export { handleSummary };
