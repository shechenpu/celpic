'use strict';

const crypto = require('node:crypto');

function validateCredentials(input) {
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(username)) {
    return '用户名需为 2–32 个字符，只能使用文字、数字、下划线或短横线';
  }
  if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) {
    return '密码长度需为 8–128 个字符';
  }
  if (typeof input.passwordConfirm !== 'string' || input.password !== input.passwordConfirm) {
    return '两次输入的密码不一致，请重新确认';
  }
  return null;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') };
}

function verifyPassword(password, user) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const actual = crypto.scryptSync(password, user.salt, 32);
  const expected = Buffer.from(user.password_hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createLimiter() {
  const counters = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of counters) if (value.until <= now) counters.delete(key);
  }, 60_000);
  timer.unref();
  return (key, maximum, windowMs) => {
    const now = Date.now();
    let value = counters.get(key);
    if (!value || value.until <= now) {
      value = { count: 0, until: now + windowMs };
      counters.set(key, value);
    }
    return ++value.count <= maximum;
  };
}

module.exports = { validateCredentials, hashPassword, verifyPassword, createLimiter };
