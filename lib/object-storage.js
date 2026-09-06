'use strict';
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hmac(key, value, encoding) { return crypto.createHmac('sha256', key).update(value).digest(encoding); }
function encodePath(value) { return String(value).split('/').map(part => encodeURIComponent(part).replace(/%2F/g, '/')).join('/'); }
function configFor(row) {
  let endpoint = String(row.endpoint || '').trim().replace(/\/$/, '');
  if (endpoint && !/^https?:\/\//i.test(endpoint)) endpoint = 'https://' + endpoint;
  return { endpoint, region: row.region || 'auto', bucket: row.bucket, accessKey: row.access_key, secretKey: row.secret_key };
}
function signedRequest(row, method, key, body, contentType) {
  const cfg = configFor(row);
  if (!cfg.endpoint || !cfg.bucket || !cfg.accessKey || !cfg.secretKey) throw new Error('云存储配置不完整，请检查 Endpoint、Bucket 和密钥');
  const base = new URL(cfg.endpoint);
  const isOss = row.driver === 'oss';
  if (isOss) base.hostname = `${cfg.bucket}.${base.hostname}`;
  base.pathname = isOss ? '/' + encodePath(key) : '/' + encodePath(cfg.bucket) + '/' + encodePath(key);
  const url = base;
  const host = url.host;
  const payloadHash = body == null ? sha256('') : sha256(body);
  const now = new Date(); const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); const day = amzDate.slice(0, 8);
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (isOss) headers['x-oss-s3-compat'] = 'true';
  if (contentType) headers['content-type'] = contentType;
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map(k => k + ':' + String(headers[k]).trim().replace(/\s+/g, ' ') + '\n').join('');
  const canonical = [method, url.pathname.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/'), url.searchParams.toString(), canonicalHeaders, signedHeaders.join(';'), payloadHash].join('\n');
  const service = 's3'; const scope = `${day}/${cfg.region}/${service}/aws4_request`; const signatureKey = hmac(hmac(hmac(hmac('AWS4' + cfg.secretKey, day), cfg.region), 's3'), 'aws4_request');
  const signature = hmac(signatureKey, `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`, 'hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
  return { url: url.href, headers };
}
async function requestError(response, action) {
  const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 240);
  return new Error(`${action}（HTTP ${response.status}）${detail ? '：' + detail : ''}`);
}
async function put(row, key, buffer, mime) { const signed = signedRequest(row, 'PUT', key, buffer, mime); const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: buffer }); if (!response.ok) throw await requestError(response, '云存储上传失败'); }
async function remove(row, key) { const signed = signedRequest(row, 'DELETE', key); const response = await fetch(signed.url, { method: 'DELETE', headers: signed.headers }); if (!response.ok && response.status !== 404) throw await requestError(response, '云存储删除失败'); }
async function get(row, key) { const signed = signedRequest(row, 'GET', key); const response = await fetch(signed.url, { method: 'GET', headers: signed.headers }); if (!response.ok) return null; return { headers: response.headers, body: response.body && Readable.fromWeb(response.body) }; }
function publicUrl(row, key) { const base = (row.public_url || row.endpoint || '').replace(/\/$/, ''); return row.public_url ? `${base}/${encodePath(key)}` : `${base}/${encodePath(row.bucket)}/${encodePath(key)}`; }
module.exports = { put, remove, get, publicUrl };
