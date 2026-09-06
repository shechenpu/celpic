'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const defaults = {
  registration: false,
  flatStorage: true,
  storageSubdir: '',
  hidePathPrefix: true,
  hideDate: true,
  siteName: 'CelPic',
  adminOrigin: '',
  imageOrigin: '',
  logoImageId: '',
  refererProtection: false,
  allowedReferers: '',
  allowEmptyReferer: true,
  maxUploadMB: 20,
  maxUploadCount: 20,
};

function openDatabase(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'celpic.db'));
  try {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL,
      salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS storage_backends (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, driver TEXT NOT NULL,
      endpoint TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', bucket TEXT NOT NULL DEFAULT '',
      access_key TEXT NOT NULL DEFAULT '', secret_key TEXT NOT NULL DEFAULT '', public_url TEXT NOT NULL DEFAULT '',
      access_mode TEXT NOT NULL DEFAULT 'proxy', enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY, file TEXT UNIQUE NOT NULL, original TEXT NOT NULL,
      mime TEXT NOT NULL, size INTEGER NOT NULL, user_id TEXT NOT NULL,
      created_at TEXT NOT NULL, storage_backend_id TEXT NOT NULL DEFAULT 'local',
      FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(storage_backend_id) REFERENCES storage_backends(id)
    );
    CREATE INDEX IF NOT EXISTS images_owner_date ON images(user_id, created_at);

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
      token_hash TEXT NOT NULL, token_hint TEXT NOT NULL, created_at TEXT NOT NULL,
      permission TEXT NOT NULL DEFAULT 'upload', expires_at TEXT, last_used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
  const tokenColumns = db.prepare('PRAGMA table_info(api_tokens)').all().map(column => column.name);
  if (!tokenColumns.includes('permission')) db.exec("ALTER TABLE api_tokens ADD COLUMN permission TEXT NOT NULL DEFAULT 'upload'");
  if (!tokenColumns.includes('expires_at')) db.exec('ALTER TABLE api_tokens ADD COLUMN expires_at TEXT');
  if (!tokenColumns.includes('last_used_at')) db.exec('ALTER TABLE api_tokens ADD COLUMN last_used_at TEXT');

  const columns = db.prepare('PRAGMA table_info(images)').all().map(column => column.name);
  if (!columns.includes('storage_backend_id')) db.exec("ALTER TABLE images ADD COLUMN storage_backend_id TEXT NOT NULL DEFAULT 'local'");
  db.exec('CREATE INDEX IF NOT EXISTS images_storage_date ON images(storage_backend_id, created_at)');
  const now = new Date().toISOString();
  if (!db.prepare('SELECT 1 FROM storage_backends WHERE id=?').get('local')) {
    db.prepare('INSERT INTO storage_backends (id,name,driver,access_mode,enabled,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('local', '本地磁盘', 'local', 'proxy', 1, 1, now, now);
  }
  if (!db.prepare('SELECT 1 FROM app_state WHERE id=1').get()) {
    const oldFile = path.join(directory, 'celpic.json');
    // Never silently reset accounts when the legacy database cannot be read.
    const old = fs.existsSync(oldFile)
      ? JSON.parse(fs.readFileSync(oldFile, 'utf8').replace(/^\uFEFF/, ''))
      : { users: [], images: [], settings: {} };
    if (!Array.isArray(old.users) || !Array.isArray(old.images)) {
      throw new Error('旧数据库格式不正确，已停止迁移；原文件未被修改。');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO app_state VALUES(1,?)').run(JSON.stringify({ ...defaults, ...old.settings }));
      for (const u of old.users) {
        db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)')
          .run(u.id, u.username, u.role, u.salt, u.hash, u.createdAt);
      }
      for (const im of old.images) {
        db.prepare('INSERT INTO images (id,file,original,mime,size,user_id,created_at) VALUES(?,?,?,?,?,?,?)')
          .run(im.id, im.file.replace(/\\/g, '/'), im.original, im.mime, im.size, im.userId, im.createdAt);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { openDatabase, defaults };




