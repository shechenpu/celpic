'use strict';

const path = require('node:path');

const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

function detectImage(bytes) {
  // Signature validation is not a full image decoder. SVG is intentionally rejected.
  if (bytes.length < 14) return null;
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))) return 'image/gif';
  if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  return null;
}

function resolveStorage(root, relative) {
  const target = path.resolve(root, relative.replace(/\\/g, '/'));
  const rel = path.relative(path.resolve(root), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('无效的存储路径');
  return target;
}

function imageUrl(image, settings) {
  const ext = extensions[image.mime];
  if (!ext) return '/i/' + encodeURIComponent(image.id);
  const date = settings.hideDate ? '' : image.created_at.slice(0,7).replace('-', '/') + '/';
  return (settings.hidePathPrefix ? '/' : '/images/') + date + image.id + '.' + ext;
}

module.exports = { detectImage, extensions, resolveStorage, imageUrl };
