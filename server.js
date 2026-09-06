'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase, defaults } = require('./lib/database');
const { validateCredentials, hashPassword, verifyPassword, createLimiter } = require('./lib/security');
const { detectImage, extensions, resolveStorage, imageUrl } = require('./lib/images');
const objectStorage = require('./lib/object-storage');

// PORT is kept as an explicit compatibility override. In particular, PORT=0 is
// meaningful to the integration tests and must not fall back to the dual-port
// defaults through JavaScript's falsy-value rules.
const HAS_PORT_OVERRIDE = Object.prototype.hasOwnProperty.call(process.env, 'PORT');
const LEGACY_PORT = HAS_PORT_OVERRIDE ? Number(process.env.PORT) : null;
const DUAL_PORTS = process.env.DUAL_PORTS === '1' || (!HAS_PORT_OVERRIDE && process.env.NODE_ENV !== 'test');
const ADMIN_PORT = DUAL_PORTS ? Number(process.env.ADMIN_PORT || 1018) : LEGACY_PORT;
const IMAGE_PORT = Number(process.env.IMAGE_PORT || 23133);
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORAGE = process.env.CELPIC_STORAGE_DIR || path.join(DATA, 'images');
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;
const MAX_REQUEST = Math.max(MAX_UPLOAD + 1_000_000, 50 * 1024 * 1024);
const secureCookie = process.env.COOKIE_SECURE === '1';
function configuredOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try { const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); return url.origin; } catch { return ''; }
}
const ADMIN_ORIGIN = configuredOrigin(process.env.ADMIN_ORIGIN) || (DUAL_PORTS ? 'http://localhost:' + ADMIN_PORT : '');
const IMAGE_ORIGIN = configuredOrigin(process.env.IMAGE_ORIGIN) || (DUAL_PORTS ? 'http://localhost:' + IMAGE_PORT : '');
function uploadLimitMB(config = settings()) { return Math.max(1, Math.min(512, Number(config.maxUploadMB) || ENV_MAX_UPLOAD_MB)); }
function uploadLimitCount(config = settings()) { return Math.max(1, Math.min(100, Number(config.maxUploadCount) || 20)); }

function currentAdminOrigin() { return configuredOrigin(settings().adminOrigin) || ADMIN_ORIGIN; }
function currentImageOrigin() { return configuredOrigin(settings().imageOrigin) || IMAGE_ORIGIN; }
function imageLink(pathname) { const origin = currentImageOrigin(); return origin ? origin + pathname : pathname; }
function requestHost(req) { return String(req.headers.host || "").toLowerCase().replace(/\.$/, ""); }
function isImageHost(req) { const origin = currentImageOrigin(); return Boolean(origin && requestHost(req) === new URL(origin).host.toLowerCase()); }
const db = openDatabase(DATA);
fs.mkdirSync(STORAGE, { recursive: true });
const sessions = new Map();
const loginFailures = new Map();
const MAX_SESSIONS_PER_USER = 5;
const TOKEN_TTLS = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
const audit = (userId, action, target = '', detail = '', ip = '') => {
  try { db.prepare('INSERT INTO audit_logs (user_id,action,target,detail,ip,created_at) VALUES(?,?,?,?,?,?)').run(userId || null, action, String(target).slice(0, 120), String(detail).slice(0, 500), String(ip).slice(0, 80), new Date().toISOString()); } catch {}
};
const limit = createLimiter();
const sessionTimer = setInterval(() => {
  for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
  for (const [key, value] of loginFailures) if (value.until <= Date.now()) loginFailures.delete(key);
}, 60_000);
sessionTimer.unref();
const settings = () => ({ ...defaults, ...JSON.parse(db.prepare('SELECT value FROM app_state WHERE id=1').get().value) });
const hasUsers = () => Boolean(db.prepare('SELECT 1 FROM users LIMIT 1').get());
const userRecord = id => db.prepare('SELECT id,username,role,created_at AS createdAt FROM users WHERE id=?').get(id);
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
function loginLockState(username, address) { const now=Date.now(); const value=['account:'+username,'ip:'+address].map(key=>loginFailures.get(key)).find(item=>item&&item.until>now&&item.count>=5); return value ? Math.ceil((value.until-now)/1000) : 0; }
function recordLoginFailure(username,address) { const now=Date.now(); for(const key of ['account:'+username,'ip:'+address]) { const previous=loginFailures.get(key); const value=previous&&previous.until>now?previous:{count:0,until:now+15*60_000}; value.count++; value.until=now+15*60_000; loginFailures.set(key,value); } }
function clearLoginFailures(username,address) { loginFailures.delete('account:'+username); loginFailures.delete('ip:'+address); }
const sessionId = req => (req.headers.cookie || '').match(/(?:^|;\s*)celpic_session=([^;]+)/)?.[1];

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readBody(req, maximum = 16_384) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maximum) throw Object.assign(new Error('请求内容过大'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  try {
    const value = JSON.parse((await readBody(req)).toString());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('请求格式不正确'), { status: 400 });
  }
}

function currentUser(req, allowToken = false) {
  const sid = sessionId(req);
  const session = sessions.get(sid);
  if (session && session.expires > Date.now()) { session.expires = Date.now() + 7 * 86400_000; return userRecord(session.userId); }
  if (sid) sessions.delete(sid);
  if (allowToken && req.headers.authorization?.startsWith('Bearer ')) {
    const raw = req.headers.authorization.slice(7).trim();
    if (raw.length > 200) return null;
    const row = db.prepare('SELECT user_id,permission,expires_at FROM api_tokens WHERE token_hash=?').get(tokenHash(raw));
    if (row && row.permission === 'upload' && (!row.expires_at || row.expires_at > new Date().toISOString())) {
      db.prepare('UPDATE api_tokens SET last_used_at=? WHERE token_hash=?').run(new Date().toISOString(), tokenHash(raw));
      return userRecord(row.user_id);
    }
  }
  return null;
}

function addUser(input, role) {
  const username = input.username.trim();
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) {
    throw Object.assign(new Error('用户名已存在'), { status: 409 });
  }
  const id = crypto.randomUUID();
  const secret = hashPassword(input.password);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)')
    .run(id, username, role, secret.salt, secret.hash, new Date().toISOString());
  return userRecord(id);
}

function listImages(me, scope, page = 1, pageSize = 24) {
  const offset = (page - 1) * pageSize;
  const rows = scope === 'all'
    ? db.prepare('SELECT images.*, users.username AS owner FROM images JOIN users ON users.id=images.user_id ORDER BY images.created_at DESC LIMIT ? OFFSET ?').all(pageSize, offset)
    : db.prepare('SELECT * FROM images WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(me.id, pageSize, offset);
  const config = settings();
  return rows.map(image => ({ ...image, url: imagePublicUrl(image, config) }));
}
function countImages(me, scope) {
  return scope === 'all'
    ? db.prepare('SELECT COUNT(*) AS count FROM images').get().count
    : db.prepare('SELECT COUNT(*) AS count FROM images WHERE user_id=?').get(me.id).count;
}

function applyStorageEnv(row) {
  if (!row) return row;
  const driver = String(process.env.STORAGE_BACKEND || '').trim();
  if (!driver) return row;
  return { ...row, driver: driver === 'local' ? 'local' : (['s3','r2','cos','oss'].includes(driver) ? driver : row.driver), endpoint: process.env.S3_ENDPOINT || row.endpoint, region: process.env.S3_REGION || row.region, bucket: process.env.S3_BUCKET || row.bucket, access_key: process.env.S3_ACCESS_KEY || row.access_key, secret_key: process.env.S3_SECRET_KEY || row.secret_key, public_url: process.env.S3_PUBLIC_URL || row.public_url, access_mode: process.env.S3_ACCESS_MODE === 'public' ? 'public' : (process.env.S3_ACCESS_MODE === 'proxy' ? 'proxy' : row.access_mode) };
}
function backendForImage(image) { return applyStorageEnv(db.prepare('SELECT * FROM storage_backends WHERE id=?').get(image.storage_backend_id || 'local')); }

function activeStorageBackend() {
  const override = String(process.env.STORAGE_BACKEND || '').trim();
  if (override === 'local') return applyStorageEnv(db.prepare('SELECT * FROM storage_backends WHERE id=?').get('local'));
  if (override) return applyStorageEnv(db.prepare('SELECT * FROM storage_backends WHERE id=? OR name=?').get(override, override) || db.prepare('SELECT * FROM storage_backends WHERE is_default=1 AND enabled=1').get());
  return applyStorageEnv(db.prepare('SELECT * FROM storage_backends WHERE is_default=1 AND enabled=1').get() || db.prepare('SELECT * FROM storage_backends WHERE id=?').get('local'));
}
function imagePublicUrl(image, config) {
  // 配置图片域名后，所有对外图片链接统一走图片域名，避免暴露后台域名或云存储地址。
  if (currentImageOrigin()) return imageLink(imageUrl(image, config));
  const backend = backendForImage(image);
  if (backend && backend.driver !== 'local' && backend.access_mode === 'public' && backend.public_url) return objectStorage.publicUrl(backend, image.file);
  return imageUrl(image, config);
}

function storageBackendView(row) {
  const imageStats = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM images WHERE storage_backend_id=?').get(row.id);
  let totalBytes = null;
  let availableBytes = null;
  if (row.driver === 'local') {
    try {
      const stat = fs.statfsSync(STORAGE);
      totalBytes = Number(stat.bsize) * Number(stat.blocks);
      availableBytes = Number(stat.bsize) * Number(stat.bavail);
    } catch {}
  }
  const usedBytes = Number(imageStats.bytes || 0);
  const remainingBytes = totalBytes == null ? null : Math.max(0, totalBytes - usedBytes);
  return { ...row, secret_key: row.secret_key ? '••••••••' : '', imageCount: imageStats.count, bytes: usedBytes,
    totalBytes, availableBytes, usedBytes, remainingBytes,
    access_mode: row.access_mode || 'proxy', enabled: Boolean(row.enabled), is_default: Boolean(row.is_default) };
}
function listStorageBackends() {
  const rows = db.prepare('SELECT * FROM storage_backends ORDER BY is_default DESC, created_at ASC').all();
  return rows.map(storageBackendView);
}
function validStorageInput(input) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('存储配置格式不正确'), { status: 400 });
  const driver = String(input.driver || '').trim();
  if (!['local','s3','r2','cos','oss'].includes(driver)) throw Object.assign(new Error('不支持的存储类型'), { status: 400 });
  const name = String(input.name || '').trim();
  if (!name || name.length > 60) throw Object.assign(new Error('存储名称需为 1–60 个字符'), { status: 400 });
  const accessMode = input.access_mode === 'public' ? 'public' : 'proxy';
  if (driver !== 'local' && (!String(input.endpoint || '').trim() || !String(input.bucket || '').trim())) throw Object.assign(new Error('云存储需要填写 Endpoint 和 Bucket'), { status: 400 });
  return { name, driver, endpoint: String(input.endpoint || '').trim().replace(/\/$/, ''), region: String(input.region || '').trim(), bucket: String(input.bucket || '').trim(), access_key: String(input.access_key || '').trim(), secret_key: String(input.secret_key || ''), public_url: String(input.public_url || '').trim().replace(/\/$/, ''), access_mode: accessMode, enabled: input.enabled === false ? 0 : 1, is_default: input.is_default === true ? 1 : 0 };
}
function publicSite() {
  const config = settings();
  return {
    siteName: config.siteName, registration: config.registration,
    logoUrl: config.logoImageId ? imageLink('/i/' + config.logoImageId) : '',
  };
}

async function serveImage(req, res, id) {
  const image = db.prepare('SELECT * FROM images WHERE id=?').get(id);
  // Do not serve legacy SVG with active content on the application origin.
  if (!image || !extensions[image.mime]) return json(res, 404, { error: '图片不存在或暂不支持此格式' });
  const config = settings();
  if (config.refererProtection) {
    const referer = req.headers.referer;
    let allowed = !referer && config.allowEmptyReferer;
    if (referer) {
      try {
        const source = new URL(referer).hostname.toLowerCase();
        const own = new URL('http://' + req.headers.host).hostname.toLowerCase();
        const domains = config.allowedReferers.split(/[\s,]+/).filter(Boolean);
        allowed = source === own || domains.includes(source);
      } catch { allowed = false; }
    }
    if (!allowed) return json(res, 403, { error: '此来源不允许访问图片' });
  }
  const backend = backendForImage(image);
  if (backend && backend.driver !== 'local') {
    if (backend.access_mode === 'public' && backend.public_url) { res.writeHead(302, { location: objectStorage.publicUrl(backend, image.file), 'cache-control': 'public, max-age=3600' }); return res.end(); }
    const remote = await objectStorage.get(backend, image.file);
    if (!remote) return json(res, 404, { error: '云端图片不存在' });
    return remote.body.pipe(res);
  }
  const file = resolveStorage(STORAGE, image.file);
  if (!fs.existsSync(file)) return json(res, 404, { error: '图片文件不存在' });
  res.writeHead(200, { 'content-type': image.mime, 'content-length': fs.statSync(file).size, 'cache-control': 'no-cache', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
  const stream = fs.createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res);
}

async function handle(req, res, serverMode = 'admin') {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' blob: " + currentImageOrigin() + "; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const imageOnly = serverMode === 'image' || isImageHost(req);
  // 图片域名只提供图片读取，拒绝后台、API、登录页和静态应用文件。
  if (imageOnly && !(req.method === 'GET' || req.method === 'HEAD') && req.method !== 'OPTIONS') return json(res, 404, { error: '图片域名仅支持读取图片' });
  if (imageOnly && !/^\/i\/[A-Za-z0-9_-]{8,64}$/.test(p) && !/^\/(?:images\/)?(?:\d{4}\/\d{2}\/)?[A-Za-z0-9_-]{8,64}\.(?:jpg|png|gif|webp)$/.test(p)) return json(res, 404, { error: '图片域名仅用于访问图片' });
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    // Cookie-authenticated writes must be same-origin; API clients use a Bearer token.
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: '禁止跨站请求' });
    if (req.headers.origin) {
      let sameOrigin = false;
      try { sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch {}
      if (!sameOrigin) return json(res, 403, { error: '禁止跨站请求' });
    }
  }
  if (req.method === 'GET') {
    const short = p.match(/^\/i\/([A-Za-z0-9_-]{8,64})$/);
    const link = p.match(/^\/(?:images\/)?(?:\d{4}\/\d{2}\/)?([A-Za-z0-9_-]{8,64})\.(?:jpg|png|gif|webp)$/);
    if (short || link) {
      if (currentImageOrigin() && !imageOnly) { res.writeHead(302, { location: imageLink(p), 'cache-control': 'public, max-age=300' }); return res.end(); }
      return await serveImage(req, res, (short || link)[1]);
    }
    const staticFiles = { '/': 'index.html', '/admin': 'index.html', '/login': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
    if (staticFiles[p]) {
      const name = staticFiles[p];
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'content-type': types[path.extname(name)], 'cache-control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', name)));
    }
  }
  if (req.method === 'GET' && p === '/api/status') {
    return json(res, 200, { setup: !hasUsers(), site: publicSite(), maxUploadMB: uploadLimitMB(), maxUploadCount: uploadLimitCount(), imageOrigin: currentImageOrigin() || '' });
  }
  if (req.method === 'POST' && ['/api/setup','/api/register'].includes(p)) {
    const setup = p === '/api/setup';
    if (setup && hasUsers()) return json(res, 409, { error: '已完成初始化' });
    if (!setup && !settings().registration) return json(res, 403, { error: '管理员未开放注册' });
    if (!limit('create:' + req.socket.remoteAddress, 20, 60_000)) return json(res, 429, { error: '请求过于频繁，请稍后再试' });
    const input = await readJson(req);
    const error = validateCredentials(input);
    if (error) return json(res, 400, { error });
    // Recheck after reading the request body to prevent two simultaneous initializations.
    if (setup && hasUsers()) return json(res, 409, { error: '已完成初始化' });
    if (!setup && !settings().registration) return json(res, 403, { error: '管理员未开放注册' });
    addUser(input, setup ? 'admin' : 'user');
    return json(res, 201, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/login') {
    const address = req.socket.remoteAddress || 'unknown';
    if (!limit('login:' + address, 30, 15 * 60_000)) return json(res, 429, { error: '登录尝试过多，请稍后再试' });
    const input = await readJson(req);
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const lockedSeconds = loginLockState(username, address);
    if (lockedSeconds) return json(res, 429, { error: '登录失败次数过多，请约 ' + Math.ceil(lockedSeconds / 60) + ' 分钟后再试' });
    const found = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!found || !verifyPassword(input.password, found)) { recordLoginFailure(username, address); audit(found?.id, 'login_failed', username, '用户名或密码错误', address); return json(res, 401, { error: '用户名或密码错误' }); }
    clearLoginFailures(username, address);
    const sid = crypto.randomBytes(32).toString('hex');
    sessions.delete(sessionId(req));
    sessions.set(sid, { userId: found.id, expires: Date.now() + 7 * 86400_000 });
    while ([...sessions.values()].filter(session => session.userId === found.id).length > MAX_SESSIONS_PER_USER) {
      const oldest = [...sessions.entries()].find(([, session]) => session.userId === found.id);
      if (!oldest) break;
      sessions.delete(oldest[0]);
    }
    audit(found.id, 'login', found.username, '登录成功', address);
    res.setHeader('set-cookie', `celpic_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secureCookie ? '; Secure' : ''}`);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/logout') {
    const loggedOut = currentUser(req);
    sessions.delete(sessionId(req));
    if (loggedOut) audit(loggedOut.id, 'logout', loggedOut.username, '退出登录', req.socket.remoteAddress || '');
    res.setHeader('set-cookie', `celpic_session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/${secureCookie ? '; Secure' : ''}`);
    return json(res, 200, { ok: true });
  }
  const me = currentUser(req, p === '/api/upload');
  if (!me) return json(res, 401, { error: '请先登录或检查上传 Token' });
  if (req.method === 'GET' && p === '/api/me') return json(res, 200, { user: me });
  if (req.method === 'GET' && p === '/api/audit-logs') {
    if (me.role !== 'admin') return json(res, 403, { error: '仅管理员可查看操作日志' });
    const rows = db.prepare('SELECT audit_logs.id,audit_logs.action,audit_logs.target,audit_logs.detail,audit_logs.ip,audit_logs.created_at AS createdAt,users.username FROM audit_logs LEFT JOIN users ON users.id=audit_logs.user_id ORDER BY audit_logs.id DESC LIMIT 200').all();
    return json(res, 200, { logs: rows });
  }
  let imageScope;
  if (p === '/api/images' || p === '/api/stats') {
    imageScope = url.searchParams.get('scope') ?? (me.role === 'admin' ? 'all' : 'mine');
    if (!['mine', 'all'].includes(imageScope)) return json(res, 400, { error: '无效的图片范围' });
    if (imageScope === 'all' && me.role !== 'admin') return json(res, 403, { error: '仅管理员可管理全站图片' });
  }
  if (req.method === 'GET' && p === '/api/images') {
    const page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
    const pageSize = Math.max(1, Math.min(60, Number.parseInt(url.searchParams.get('pageSize') || '12', 10) || 24));
    const total = countImages(me, imageScope);
    return json(res, 200, { images: listImages(me, imageScope, page, pageSize), pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } });
  }
  if (req.method === 'GET' && p === '/api/stats') {
    const totals = imageScope === 'all'
      ? db.prepare('SELECT COUNT(*) AS images, COALESCE(SUM(size), 0) AS bytes FROM images').get()
      : db.prepare('SELECT COUNT(*) AS images, COALESCE(SUM(size), 0) AS bytes FROM images WHERE user_id=?').get(me.id);
    return json(res, 200, { images: totals.images, bytes: totals.bytes });
  }
  if (p === '/api/storage-backends') {
    if (me.role !== 'admin') return json(res, 403, { error: '仅管理员可管理存储' });
    if (req.method === 'GET') return json(res, 200, { backends: listStorageBackends(), envOverride: process.env.STORAGE_BACKEND || '' });
    if (req.method === 'POST' && url.searchParams.get('action') === 'test') {
      const body = await readJson(req); const row = db.prepare('SELECT * FROM storage_backends WHERE id=?').get(String(body.id || ''));
      if (!row) return json(res, 404, { error: '存储后端不存在' });
      if (row.driver === 'local') { fs.mkdirSync(STORAGE, { recursive: true }); fs.accessSync(STORAGE, fs.constants.R_OK | fs.constants.W_OK); return json(res, 200, { ok: true, message: '本地存储可正常读写' }); }
      const key = `.celpic-connection-test-${crypto.randomBytes(8).toString('hex')}.txt`;
      try { await objectStorage.put(row, key, Buffer.from('CelPic connection test', 'utf8'), 'text/plain'); await objectStorage.remove(row, key); return json(res, 200, { ok: true, message: '云存储连接、上传和删除测试成功' }); }
      catch (error) { try { await objectStorage.remove(row, key); } catch {} return json(res, 502, { error: error.message || '云存储连接测试失败' }); }
    }
    if (req.method === 'POST') {
      const input = validStorageInput(await readJson(req));
      if (input.driver === 'local') return json(res,400,{error:'本地磁盘是系统内置存储，无需重复添加'}); const id = crypto.randomBytes(12).toString('base64url'); const now = new Date().toISOString();
      if (input.is_default) db.prepare('UPDATE storage_backends SET is_default=0').run();
      db.prepare('INSERT INTO storage_backends (id,name,driver,endpoint,region,bucket,access_key,secret_key,public_url,access_mode,enabled,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.name,input.driver,input.endpoint,input.region,input.bucket,input.access_key,input.secret_key,input.public_url,input.access_mode,input.enabled,input.is_default,now,now);
      return json(res, 201, { backend: storageBackendView(db.prepare('SELECT * FROM storage_backends WHERE id=?').get(id)) });
    }
    if (req.method === 'PUT') {
      const body = await readJson(req); const id = String(body.id || ''); const current = db.prepare('SELECT * FROM storage_backends WHERE id=?').get(id); if (!current) return json(res,404,{error:'存储后端不存在'});
      if (id === 'local' && body.driver && body.driver !== 'local') return json(res,400,{error:'系统内置本地存储不能更换类型'});
      const input = validStorageInput({ ...current, ...body, secret_key: body.secret_key || current.secret_key }); if (input.is_default) db.prepare('UPDATE storage_backends SET is_default=0').run();
      db.prepare('UPDATE storage_backends SET name=?,driver=?,endpoint=?,region=?,bucket=?,access_key=?,secret_key=?,public_url=?,access_mode=?,enabled=?,is_default=?,updated_at=? WHERE id=?').run(input.name,input.driver,input.endpoint,input.region,input.bucket,input.access_key,input.secret_key,input.public_url,input.access_mode,input.enabled,input.is_default,new Date().toISOString(),id);
      return json(res,200,{backend:storageBackendView(db.prepare('SELECT * FROM storage_backends WHERE id=?').get(id))});
    }
    if (req.method === 'DELETE') { const body=await readJson(req); const id=String(body.id||''); if(id==='local') return json(res,400,{error:'本地磁盘不能删除'}); const used=db.prepare('SELECT COUNT(*) AS count FROM images WHERE storage_backend_id=?').get(id).count; if(used) return json(res,409,{error:'该存储仍有图片，不能删除'}); db.prepare('DELETE FROM storage_backends WHERE id=?').run(id); return json(res,200,{ok:true}); }
  }
  if (p === '/api/users') {
    if (me.role !== 'admin') return json(res, 403, { error: '仅管理员可管理用户' });
    if (req.method === 'GET') return json(res, 200, { users: db.prepare('SELECT id,username,role,created_at AS createdAt FROM users ORDER BY created_at').all() });
    if (req.method === 'POST') {
      if (!limit('admin-create:' + me.id, 20, 60_000)) return json(res, 429, { error: '创建过于频繁' });
      const input = await readJson(req);
      const error = validateCredentials(input);
      if (error) return json(res, 400, { error });
      if (!['user','admin'].includes(input.role)) return json(res, 400, { error: '请选择有效角色' });
      return json(res, 201, { user: addUser(input, input.role) });
    }
  }
  if (p === '/api/settings') {
    if (me.role !== 'admin') return json(res, 403, { error: '仅管理员可修改设置' });
    if (req.method === 'GET') return json(res, 200, { settings: settings() });
    if (req.method === 'PUT') {
      const input = await readJson(req);
      const next = { ...settings() };
      for (const key of ['registration','flatStorage','hidePathPrefix','hideDate','refererProtection','allowEmptyReferer']) {
        if (key in input) {
          if (typeof input[key] !== 'boolean') return json(res, 400, { error: '开关设置格式错误' });
          next[key] = input[key];
        }
      }
      for (const key of ['adminOrigin','imageOrigin']) {
        if (key in input) {
          if (typeof input[key] !== 'string' || (input[key] && !configuredOrigin(input[key]))) return json(res, 400, { error: '域名格式不正确，请填写 http(s)://域名[:端口]' });
          next[key] = input[key].trim();
        }
      }
      if ('storageSubdir' in input) {
        if (typeof input.storageSubdir !== 'string' || !/^(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(input.storageSubdir) || input.storageSubdir.length > 120) {
          return json(res, 400, { error: '存储子目录只能包含字母、数字、短横线、下划线和 /，不能使用 .. 或绝对路径' });
        }
        next.storageSubdir = input.storageSubdir;
      }
      if ('siteName' in input) {
        if (typeof input.siteName !== 'string' || !input.siteName.trim() || input.siteName.length > 40) return json(res, 400, { error: '站点名称需为 1–40 个字符' });
        next.siteName = input.siteName.trim();
      }
      if ('maxUploadMB' in input) { const value = Number(input.maxUploadMB); if (!Number.isInteger(value) || value < 1 || value > 512) return json(res, 400, { error: '单张图片大小需为 1–512 MB 的整数' }); next.maxUploadMB = value; }
      if ('maxUploadCount' in input) { const value = Number(input.maxUploadCount); if (!Number.isInteger(value) || value < 1 || value > 100) return json(res, 400, { error: '单次上传数量需为 1–100 张的整数' }); next.maxUploadCount = value; }
      if ('allowedReferers' in input) {
        if (typeof input.allowedReferers !== 'string' || input.allowedReferers.length > 2000) return json(res, 400, { error: '域名列表格式错误' });
        const domains = input.allowedReferers.toLowerCase().split(/[\s,]+/).filter(Boolean);
        if (domains.some(domain => !/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(domain))) return json(res, 400, { error: '请填写域名，不要包含协议、端口或路径' });
        next.allowedReferers = domains.join('\n');
      }
      if ('logoImageId' in input) {
        if (typeof input.logoImageId !== 'string') return json(res, 400, { error: 'Logo 格式错误' });
        if (input.logoImageId) {
          const image = db.prepare('SELECT mime FROM images WHERE id=?').get(input.logoImageId);
          if (!image || !extensions[image.mime]) return json(res, 400, { error: 'Logo 图片不存在' });
        }
        next.logoImageId = input.logoImageId;
      }
      db.prepare('UPDATE app_state SET value=? WHERE id=1').run(JSON.stringify(next));
      return json(res, 200, { settings: next });
    }
  }
  if (p === '/api/tokens') {
    if (req.method === 'GET') return json(res, 200, { tokens: db.prepare('SELECT id,label,token_hint AS hint,permission,expires_at AS expiresAt,last_used_at AS lastUsedAt,created_at AS createdAt FROM api_tokens WHERE user_id=? ORDER BY created_at DESC').all(me.id) });
    if (req.method === 'POST') {
      const input = await readJson(req);
      if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 40) return json(res, 400, { error: '令牌名称需为 1–40 个字符' });
      if (db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id=?').get(me.id).n >= 20) return json(res, 400, { error: '最多保留 20 个令牌，请撤销不使用的令牌' });
      const ttl = String(input.expiresIn || 'never');
      if (ttl !== 'never' && !TOKEN_TTLS[ttl]) return json(res, 400, { error: '令牌有效期不正确' });
      const raw = 'cp_' + crypto.randomBytes(32).toString('hex'); const now = new Date();
      const expiresAt = ttl === 'never' ? null : new Date(now.getTime() + TOKEN_TTLS[ttl] * 86400_000).toISOString();
      db.prepare('INSERT INTO api_tokens (id,user_id,label,token_hash,token_hint,created_at,permission,expires_at,last_used_at) VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), me.id, input.label.trim(), tokenHash(raw), raw.slice(0,11), now.toISOString(), 'upload', expiresAt, null);
      audit(me.id, 'token_created', input.label.trim(), ttl === 'never' ? '永久令牌' : '有效期 ' + ttl, req.socket.remoteAddress || '');
      return json(res, 201, { token: raw, expiresAt });
    }
  }
  if (req.method === 'DELETE' && p.startsWith('/api/tokens/')) {
    const tokenId = p.split('/').pop();
    const removed = db.prepare('DELETE FROM api_tokens WHERE id=? AND user_id=?').run(tokenId, me.id);
    if (!removed.changes) return json(res, 404, { error: '令牌不存在' });
    audit(me.id, 'token_revoked', tokenId, '撤销上传令牌', req.socket.remoteAddress || '');
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/upload') {
    if (!limit('upload:' + me.id, 120, 60_000)) return json(res, 429, { error: '上传过于频繁，请稍后再试' });
    const type = req.headers['content-type'] || '';
    if (!type.startsWith('multipart/form-data;')) return json(res, 400, { error: '请使用 multipart/form-data 上传' });
    const config = settings();
    const bytes = await readBody(req, Math.max(uploadLimitMB(config) * uploadLimitCount(config) * 1024 * 1024 + 2_000_000, MAX_REQUEST));
    let form;
    try { form = await new Request('http://localhost', { method: 'POST', headers: { 'content-type': type }, body: bytes }).formData(); }
    catch { return json(res, 400, { error: '上传格式无效' }); }
    const files = [...form.values()].filter(file => typeof file !== 'string');
    if (!files.length || files.length > uploadLimitCount(config)) return json(res, 400, { error: '每个请求最多上传 ' + uploadLimitCount(config) + ' 张图片' });
    const backend = activeStorageBackend();
    const created = [], errors = [];
    for (const file of files) {
      if (file.size > uploadLimitMB(config) * 1024 * 1024) { errors.push({ name: file.name, error: '超过单张大小限制' }); continue; }
      const buffer = Buffer.from(await file.arrayBuffer());
      const mime = detectImage(buffer);
      if (!mime) { errors.push({ name: file.name, error: '仅支持 JPG、PNG、GIF、WebP；不支持 SVG 或伪装文件' }); continue; }
      const id = crypto.randomBytes(12).toString('base64url');
      const createdAt = new Date().toISOString();
      const date = config.flatStorage ? '' : createdAt.slice(0,7).replace('-', '/');
      const relative = [config.storageSubdir, date, id + '.' + extensions[mime]].filter(Boolean).join('/');
      const image = { id, file: relative, original: path.basename(file.name.replace(/\\/g, '/')).slice(0,120), mime, size: buffer.length, user_id: me.id, created_at: createdAt };
      let localFile = '';
      try {
        if (backend.driver === 'local') { localFile = resolveStorage(STORAGE, relative); fs.mkdirSync(path.dirname(localFile), { recursive: true }); fs.writeFileSync(localFile, buffer, { flag: 'wx', mode: 0o600 }); }
        else await objectStorage.put(backend, relative, buffer, mime);
        db.prepare('INSERT INTO images (id,file,original,mime,size,user_id,created_at,storage_backend_id) VALUES(?,?,?,?,?,?,?,?)').run(id, relative, image.original, mime, image.size, me.id, createdAt, backend.id);
      } catch (error) { if (localFile) fs.rmSync(localFile, { force: true }); else if (backend.driver !== 'local') { try { await objectStorage.remove(backend, relative); } catch {} } throw error; }
      created.push({ ...image, storage_backend_id: backend.id, url: imagePublicUrl({ ...image, storage_backend_id: backend.id }, config) });
    }
    if (created.length) audit(me.id, 'upload', String(created.length), '上传图片', req.socket.remoteAddress || '');
    return json(res, created.length ? 201 : 400, { images: created, errors, ...(created.length ? {} : { error: errors[0]?.error || '未上传有效图片' }) });
  }
  if (req.method === 'DELETE' && p === '/api/images') {
    const input = await readJson(req);
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100 || input.ids.some(id => typeof id !== 'string')) return json(res, 400, { error: '每次可删除 1–100 张图片' });
    const selected = [...new Set(input.ids)].map(id => db.prepare('SELECT * FROM images WHERE id=?').get(id));
    if (selected.some(image => !image || ((me.role !== 'admin' || imageScope === 'mine') && image.user_id !== me.id))) return json(res, 403, { error: '选择中包含不存在或无权删除的图片' });
    for (const image of selected) {
      const backend = backendForImage(image);
      if (backend && backend.driver !== 'local') await objectStorage.remove(backend, image.file);
      else fs.rmSync(resolveStorage(STORAGE, image.file), { force: true });
      db.prepare('DELETE FROM images WHERE id=?').run(image.id);
    }
    const config = settings();
    if (input.ids.includes(config.logoImageId)) {
      config.logoImageId = '';
      db.prepare('UPDATE app_state SET value=? WHERE id=1').run(JSON.stringify(config));
    }
    return json(res, 200, { deleted: selected.length });
  }
  return json(res, 404, { error: '接口不存在' });
}

function createServer(mode) {
  const instance = http.createServer((req, res) => {
    handle(req, res, mode).catch(error => {
      if (res.headersSent || res.destroyed) return res.destroy();
      if (!error.status) console.error('请求处理失败:', error.message);
      json(res, error.status || 500, { error: error.status ? error.message : '服务器处理失败，请检查服务日志' });
    });
  });
  instance.requestTimeout = 60_000;
  instance.headersTimeout = 20_000;
  return instance;
}
const adminServer = createServer('admin');
const imageServer = DUAL_PORTS && IMAGE_PORT !== ADMIN_PORT ? createServer('image') : null;
const bindAddress = process.env.HOST || process.env.BIND_ADDRESS || '0.0.0.0';
function listenServer(instance, port, label) {
  instance.listen(port, bindAddress, () => console.log('CelPic ' + label + ' listening on :' + instance.address().port));
}
listenServer(adminServer, ADMIN_PORT, 'admin');
if (imageServer) listenServer(imageServer, IMAGE_PORT, 'image');
function shutdown() {
  const servers = [adminServer, imageServer].filter(Boolean);
  let left = servers.length;
  for (const instance of servers) instance.close(() => { if (--left === 0) { db.close(); process.exit(0); } });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);


