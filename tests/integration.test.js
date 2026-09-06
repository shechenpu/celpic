'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { validateCredentials, hashPassword } = require('../lib/security');
const { openDatabase } = require('../lib/database');
const { resolveStorage, detectImage } = require('../lib/images');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'celpic-test-'));
const storage = path.join(temporary, 'images');
let server, base, admin, member, secondAdmin, image, token;
const password = 'test-password-2026';
const credentials = (username, extra = {}) => ({ username, password, passwordConfirm: password, ...extra });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4WQAAAAASUVORK5CYII=', 'base64');
async function request(endpoint, { method = 'GET', cookie, data, form, authorization, headers = {} } = {}) {
  const response = await fetch(base + endpoint, {
    method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}), ...headers },
    body: form || (data ? JSON.stringify(data) : undefined),
  });
  return { response, status: response.status, data: await response.json() };
}
async function login(username) {
  const result = await request('/api/login', { method: 'POST', data: { username, password } });
  assert.equal(result.status, 200);
  return result.response.headers.get('set-cookie').split(';')[0];
}
async function upload(cookie, bytes = png, type = 'image/png', name = 'test.png', authorization) {
  const form = new FormData(); form.append('files', new Blob([bytes], { type }), name);
  return request('/api/upload', { method: 'POST', cookie, form, authorization });
}
before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: path.join(temporary, 'db'), CELPIC_STORAGE_DIR: storage, MAX_UPLOAD_MB: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Server startup timeout: ' + output)), 10_000);
    server.stdout.on('data', chunk => {
      output += chunk;
      const found = output.match(/listening on :(\d+)/);
      if (found) { clearTimeout(timer); resolve('http://127.0.0.1:' + found[1]); }
    });
    server.stderr.on('data', chunk => { output += chunk; });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', () => { clearTimeout(timer); reject(new Error('Server stopped: ' + output)); });
  });
});
after(async () => {
  if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill(); await stopped; }
  const target = path.resolve(temporary), root = path.resolve(os.tmpdir());
  const relative = path.relative(root, target);
  assert.ok(relative.startsWith('celpic-test-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
  fs.rmSync(target, { recursive: true, force: true });
});

test('credential validation rejects missing, mismatched, short and oversized passwords', () => {
  assert.equal(validateCredentials(credentials('测试用户')), null);
  for (const input of [credentials('tester', { passwordConfirm: '' }), credentials('tester', { passwordConfirm: 'incorrect' }), credentials('tester', { password: 'short', passwordConfirm: 'short' }), credentials('tester', { password: 'a'.repeat(129), passwordConfirm: 'a'.repeat(129) }), credentials('../bad')]) assert.ok(validateCredentials(input));
});
test('legacy JSON migrates to SQLite without changing the original file', () => {
  const directory = path.join(temporary, 'migration'); fs.mkdirSync(directory);
  const secret = hashPassword(password);
  const legacy = JSON.stringify({ users: [{ id:'legacy-user', username:'legacy', role:'admin', salt:secret.salt, hash:secret.hash, createdAt:'2026-09-05T00:00:00Z' }], images: [{ id:'legacy-image', file:'2026\\09\\old.png', original:'old.png', mime:'image/png', size:4, userId:'legacy-user', createdAt:'2026-09-05T00:00:00Z' }], settings: { flatStorage:false } });
  fs.writeFileSync(path.join(directory,'celpic.json'), legacy);
  const database = openDatabase(directory);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(database.prepare('SELECT file FROM images').get().file, '2026/09/old.png');
  database.close(); assert.equal(fs.readFileSync(path.join(directory,'celpic.json'),'utf8'), legacy);
  const reopened = openDatabase(directory); assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM users').get().n,1); reopened.close();
});
test('corrupt legacy JSON fails closed', () => {
  const directory = path.join(temporary,'corrupt'); fs.mkdirSync(directory); fs.writeFileSync(path.join(directory,'celpic.json'),'{bad');
  assert.throws(() => openDatabase(directory));
});
test('storage path rejects traversal; SVG is not an accepted image', () => {
  assert.throws(() => resolveStorage(storage,'../escape'));
  assert.equal(detectImage(Buffer.from('<svg onload="alert(1)"></svg>')), null);
});
test('initialization requires password confirmation and does not create an account on failure', async () => {
  assert.equal((await request('/api/status')).data.setup, true);
  for (const confirmation of ['', 'wrong-password']) {
    const result = await request('/api/setup', { method:'POST', data:credentials('admin',{passwordConfirm:confirmation}) });
    assert.equal(result.status,400); assert.equal((await request('/api/status')).data.setup,true);
  }
  assert.equal((await request('/api/setup',{method:'POST',data:credentials('admin')})).status,201);
  assert.equal((await request('/api/setup',{method:'POST',data:credentials('another')})).status,409);
  admin = await login('admin');
});
test('administrator cannot create either role with mismatched passwords', async () => {
  for (const role of ['user','admin']) {
    const before = (await request('/api/users',{cookie:admin})).data.users.length;
    assert.equal((await request('/api/users',{method:'POST',cookie:admin,data:credentials(role+'-wrong',{role,passwordConfirm:'wrong'})})).status,400);
    assert.equal((await request('/api/users',{cookie:admin})).data.users.length,before);
  }
});
test('administrator creates a normal user and another administrator', async () => {
  for (const [username,role] of [['member','user'],['admin2','admin']]) {
    assert.equal((await request('/api/users',{method:'POST',cookie:admin,data:credentials(username,{role})})).status,201);
  }
  member = await login('member'); secondAdmin = await login('admin2');
  assert.equal((await request('/api/me',{cookie:secondAdmin})).data.user.role,'admin');
  assert.equal((await request('/api/users',{method:'POST',cookie:admin,data:credentials('member',{role:'user'})})).status,409);
});
test('normal users cannot create users or change settings', async () => {
  assert.equal((await request('/api/users',{method:'POST',cookie:member,data:credentials('attacker',{role:'admin'})})).status,403);
  assert.equal((await request('/api/settings',{method:'PUT',cookie:member,data:{registration:true}})).status,403);
});
test('registration is controlled by the administrator and enforces confirmation', async () => {
  assert.equal((await request('/api/register',{method:'POST',data:credentials('public')})).status,403);
  await request('/api/settings',{method:'PUT',cookie:admin,data:{registration:true}});
  assert.equal((await request('/api/status')).data.site.registration,true);
  assert.equal((await request('/api/register',{method:'POST',data:credentials('public',{passwordConfirm:'wrong'})})).status,400);
  assert.equal((await request('/api/register',{method:'POST',data:credentials('public',{role:'admin'})})).status,201);
  const registered = await login('public'); assert.equal((await request('/api/me',{cookie:registered})).data.user.role,'user');
  await request('/api/settings',{method:'PUT',cookie:admin,data:{registration:false}});
});
test('uploads return real results; other users cannot list, count or delete them', async () => {
  const result = await upload(admin); assert.equal(result.status,201); image = result.data.images[0];
  assert.equal((await request('/api/images',{cookie:member})).data.images.length,0);
  assert.equal((await request('/api/stats',{cookie:member})).data.images,0);
  assert.equal((await request('/api/images',{method:'DELETE',cookie:member,data:{ids:[image.id]}})).status,403);
  const direct = await fetch(base+image.url); assert.equal(direct.status,200); assert.deepEqual(Buffer.from(await direct.arrayBuffer()),png);
  assert.equal((await fetch(base+'/i/'+image.id)).status,200);
});
test('personal and admin galleries enforce scope for listing, stats and atomic deletion', async () => {
  const own = (await upload(member)).data.images[0];
  const mine = (await request('/api/images?scope=mine',{cookie:admin})).data.images;
  assert.ok(mine.some(row=>row.id===image.id));
  assert.ok(!mine.some(row=>row.id===own.id));
  const all = (await request('/api/images?scope=all',{cookie:admin})).data.images;
  assert.equal(all.find(row=>row.id===own.id).owner,'member');
  assert.equal(all.find(row=>row.id===image.id).owner,'admin');
  const personal = (await request('/api/images?scope=mine',{cookie:member})).data.images;
  assert.deepEqual(personal.map(row=>row.id),[own.id]);
  for (const [cookie,scope,rows] of [[admin,'mine',mine],[admin,'all',all],[member,'mine',personal]]) {
    const stats=(await request('/api/stats?scope='+scope,{cookie})).data;
    assert.equal(stats.images,rows.length);
    assert.equal(stats.bytes,rows.reduce((sum,row)=>sum+row.size,0));
  }
  for (const endpoint of ['/api/images','/api/stats']) {
    assert.equal((await request(endpoint+'?scope=all',{cookie:member})).status,403);
    assert.equal((await request(endpoint+'?scope=invalid',{cookie:admin})).status,400);
    assert.equal((await request(endpoint+'?scope=mine')).status,401);
  }
  for (const [cookie,scope,ids] of [[admin,'mine',[image.id,own.id]],[member,'mine',[own.id,image.id]],[member,'all',[image.id]]]) {
    assert.equal((await request('/api/images?scope='+scope,{method:'DELETE',cookie,data:{ids}})).status,403);
  }
  assert.equal((await fetch(base+image.url)).status,200);
  assert.equal((await fetch(base+own.url)).status,200);
  assert.equal((await request('/api/images?scope=mine',{method:'DELETE',cookie:member,data:{ids:[own.id]}})).data.deleted,1);
  const another=(await upload(member)).data.images[0];
  assert.equal((await request('/api/images?scope=all',{method:'DELETE',cookie:admin,data:{ids:[another.id]}})).data.deleted,1);
});
test('SVG, spoofed MIME and oversize uploads are rejected', async () => {
  assert.equal((await upload(admin,Buffer.from('<svg onload="alert(1)"></svg>'),'image/svg+xml','bad.svg')).status,400);
  assert.equal((await upload(admin,Buffer.from('not an image file'),'image/png','bad.png')).status,400);
  assert.equal((await upload(admin,Buffer.alloc(1024*1024+1),'image/png','huge.png')).status,400);
});
test('flat directory, date links, custom subdirectory and old links work independently', async () => {
  assert.equal((await request('/api/settings',{method:'PUT',cookie:admin,data:{storageSubdir:'../outside'}})).status,400);
  await request('/api/settings',{method:'PUT',cookie:admin,data:{storageSubdir:'0',flatStorage:true,hideDate:false,hidePathPrefix:false}});
  const uploaded = (await upload(admin)).data.images[0];
  assert.match(uploaded.file,/^0\//); assert.match(uploaded.url,/^\/images\/\d{4}\/\d{2}\//);
  assert.ok(fs.existsSync(path.join(storage,uploaded.file)));
  const oldLink = uploaded.url;
  await request('/api/settings',{method:'PUT',cookie:admin,data:{hideDate:true,hidePathPrefix:true}});
  assert.equal((await fetch(base+oldLink)).status,200);
  assert.match((await request('/api/images',{cookie:admin})).data.images.find(x=>x.id===uploaded.id).url,/^\/[^/]+\.png$/);
});
test('cross-origin state changes fail and static files stay restricted', async () => {
  assert.equal((await request('/api/settings',{method:'PUT',cookie:admin,data:{registration:true},headers:{origin:'https://evil.example'}})).status,403);
  assert.notEqual((await fetch(base+'/../server.js')).status,200);
  const page = await fetch(base+'/'); assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
});
test('upload tokens work, cannot administer, and can be revoked', async () => {
  const created = await request('/api/tokens',{method:'POST',cookie:member,data:{label:'test-client'}}); token = created.data.token;
  assert.equal(created.status,201);
  assert.equal((await upload(undefined,png,'image/png','token.png','Bearer '+token)).status,201);
  assert.equal((await request('/api/users',{authorization:'Bearer '+token})).status,401);
  const rows = (await request('/api/tokens',{cookie:member})).data.tokens;
  assert.equal(JSON.stringify(rows).includes(token),false);
  await request('/api/tokens/'+rows[0].id,{method:'DELETE',cookie:member});
  assert.equal((await upload(undefined,png,'image/png','token.png','Bearer '+token)).status,401);
});
test('Referer protection allows configured domains and blocks others', async () => {
  await request('/api/settings',{method:'PUT',cookie:admin,data:{refererProtection:true,allowedReferers:'blog.example.com',allowEmptyReferer:false}});
  assert.equal((await fetch(base+image.url,{headers:{referer:'https://evil.example/'}})).status,403);
  assert.equal((await fetch(base+image.url)).status,403);
  assert.equal((await fetch(base+image.url,{headers:{referer:'https://blog.example.com/article'}})).status,200);
  await request('/api/settings',{method:'PUT',cookie:admin,data:{refererProtection:false}});
});
test('administrator can batch-delete files and logout invalidates the session', async () => {
  const rows = (await request('/api/images',{cookie:admin})).data.images;
  assert.equal((await request('/api/images',{method:'DELETE',cookie:admin,data:{ids:rows.map(x=>x.id)}})).data.deleted,rows.length);
  assert.equal((await request('/api/images',{cookie:admin})).data.images.length,0);
  await request('/api/logout',{method:'POST',cookie:admin}); assert.equal((await request('/api/me',{cookie:admin})).status,401);
});
