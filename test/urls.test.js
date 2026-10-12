'use strict';

const assert = require('assert');
const urls = require('../lib/urls.js');

const sample =
  'https://scontent-lax3-1.cdninstagram.com/v/t51.2885-15/12345_n.jpg?stp=dst-jpg_e35_s640x640_sh0.08&_nc_ht=scontent-lax3-1.cdninstagram.com';

assert.strictEqual(urls.isAllowedImageUrl(sample), true);
assert.strictEqual(urls.isAllowedImageUrl('https://instagram.fcgh3-1.fna.fbcdn.net/v/a.jpg'), true);
assert.strictEqual(urls.isAllowedImageUrl('https://www.instagram.com/p/abc/media/?size=l'), true);
assert.strictEqual(urls.isAllowedImageUrl('https://www.instagram.com/username/'), false);
assert.strictEqual(urls.isAllowedImageUrl('https://evil.com/a.jpg'), false);
assert.strictEqual(urls.isAllowedImageUrl('http://scontent.cdninstagram.com/a.jpg'), false);
assert.strictEqual(urls.isAllowedImageUrl('https://evilcdninstagram.com/a.jpg'), false);

assert.strictEqual(urls.canonicalKey(sample), '/v/t51.2885-15/12345_n.jpg');
assert.strictEqual(urls.sizeScore(sample), 640 * 640);
assert.strictEqual(urls.qualityRank(sample), 640 * 640);
assert.strictEqual(
  urls.qualityRank('https://scontent.cdninstagram.com/v/t51.2885-15/orig.jpg'),
  Number.MAX_SAFE_INTEGER
);

const larger = new URL(urls.largerUrl(sample));
assert.strictEqual(larger.searchParams.get('stp'), 'dst-jpg_e35_s1080x1080_sh0.08');
assert.strictEqual(larger.searchParams.get('_nc_ht'), 'scontent-lax3-1.cdninstagram.com');

const already = sample.replace('s640x640', 's1080x1080');
assert.strictEqual(new URL(urls.largerUrl(already)).searchParams.get('stp'), 'dst-jpg_e35_s1080x1080_sh0.08');
assert.strictEqual(
  urls.largerUrl('https://scontent.cdninstagram.com/v/a.jpg'),
  'https://scontent.cdninstagram.com/v/a.jpg'
);

const rect = new URL(urls.largerUrl('https://scontent.cdninstagram.com/v/a.jpg?stp=s640x480'));
assert.strictEqual(rect.searchParams.get('stp'), 's1080x810');
const tiny = new URL(urls.largerUrl('https://scontent.cdninstagram.com/v/a.jpg?stp=s64x64'));
assert.strictEqual(tiny.searchParams.get('stp'), 's64x64');

assert.strictEqual(urls.looksLikeUiAsset('https://static.cdninstagram.com/rsrc.php/x.png'), true);
assert.strictEqual(urls.looksLikeUiAsset(sample), false);
assert.strictEqual(urls.pageFolder('/p/AbC123/'), 'p_AbC123');
assert.strictEqual(urls.pageFolder('/user.name/'), 'user.name');

const name = urls.buildFilename('p_AbC123', 0, sample, new Date(2026, 9, 4));
assert.strictEqual(name, 'instagram-images/2026-10-04_p_AbC123/01-12345_n.jpg');
assert.strictEqual(urls.safeFilename(name), name);
assert.strictEqual(urls.safeFilename('instagram-images/../../etc/passwd'), '');
assert.strictEqual(urls.safeFilename('https://evil.com/a.jpg'), '');
assert.strictEqual(urls.safeFilename('instagram-images/page/file.html'), '');

console.log('urls tests passed');
