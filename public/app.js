'use strict';

const $ = selector => document.querySelector(selector);
const app = $('#app');
const state = { user: null, images: [], selected: new Set(), tab: 'upload', site: {}, maxUploadMB: 20, maxUploadCount: 20, loading: false, uploads: [], pagination: { page: 1, pageSize: 12, total: 0, pages: 1 } };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
function imageHref(value) { const raw = String(value ?? ''); return /^https?:\/\//i.test(raw) ? raw : location.origin + (raw.startsWith('/') ? raw : '/' + raw); }
const paths = {
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9"/><circle cx="9" cy="7" r="4"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  moon: '<path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>',
  logout: '<path d="M9 21H3V3h6m5 5 5 4-5 4m-7-4h12"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-5-5 3-3m-1 5 3-3"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  link: '<path d="m10 13 4-4m-5 7-1.5 1.5a4 4 0 0 1-5.6-5.6L6 8.8a4 4 0 0 1 5.6 0m1.4 6.4a4 4 0 0 0 5.6 0l3.1-3.1a4 4 0 0 0-5.6-5.6L14.5 8"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
  markdown: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 15V9l3 3 3-3v6m6-6v6m-2-2 2 2 2-2"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  folder: '<path d="M3 20h18V7H11L9 4H3z"/>',
  storageFolder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  disk: '<path d="M5 6h14l2 4v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7l2-4Z"/><path d="M3 11h18M7 16h.01M11 16h.01"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6 8a5 5 0 0 0 1 10Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.8-3L3 11m0 0V5m0 6h6M4 13a8 8 0 0 0 14.8 3L21 13m0 0v6m0-6h-6"/>',
};
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.image}</svg>`; }
function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}
function date(value) { return new Date(value).toLocaleDateString('zh-CN'); }
function toast(text) {
  document.querySelectorAll('.toast').forEach(item => item.remove());
  const element = document.createElement('div');
  element.className = 'toast'; element.role = 'status'; element.textContent = text;
  (document.querySelector('dialog[open]') || document.body).append(element); setTimeout(() => element.remove(), 4500);
}
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试');
  return data;
}
const send = (url, method, data) => api(url, { method, headers: { 'content-type':'application/json' }, body: JSON.stringify(data) });
async function copyText(text, feedback = '内容') {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const field = document.createElement('textarea'); field.value = text; field.className = 'clipboard-field';
      (document.querySelector('dialog[open]') || document.body).append(field); field.select(); const copied = document.execCommand('copy'); field.remove();
      if (!copied) throw new Error();
    }
    toast('已复制' + feedback + '，可直接粘贴');
  } catch { toast('复制失败，请使用 HTTPS 或手动复制链接'); }
}
function logo() {
  return state.site.logoUrl ? `<img class="brand-icon custom-logo" src="${esc(state.site.logoUrl)}" alt="">` : '<span class="brand-icon">c<span class="logo-dot">.</span></span>';
}
function logoLink() { return `<a class="brand-link" href="/" title="返回 CelPic 前台">${logo()}<span class="brand-name">${esc(state.site.siteName || 'CelPic')}</span></a>`; }
function field(id, label, type = 'text', attributes = '') {
  return `<label class="field" for="${id}"><span>${label}</span><input id="${id}" name="${id}" type="${type}" ${attributes}></label>`;
}
function credentials(prefix) {
  return field(prefix + 'Username', '用户名', 'text', 'required minlength="2" maxlength="32" autocomplete="username" placeholder="2–32 个文字、数字或下划线"') +
    field(prefix + 'Password', '密码', 'password', 'required minlength="8" maxlength="128" autocomplete="new-password" placeholder="至少 8 个字符"') +
    field(prefix + 'Confirm', '确认密码', 'password', 'required minlength="8" maxlength="128" autocomplete="new-password" placeholder="请再次输入密码" aria-describedby="' + prefix + 'Error"') +
    `<label class="checkbox-line"><input type="checkbox" data-reveal="${prefix}">显示密码</label>`;
}
function formError(form, message = '') { form.querySelector('.form-error').textContent = message; }
function credentialValues(prefix) {
  return { username: $('#' + prefix + 'Username').value.trim(), password: $('#' + prefix + 'Password').value, passwordConfirm: $('#' + prefix + 'Confirm').value };
}
function bindCredentials(form, prefix) {
  const password = $('#' + prefix + 'Password'), confirm = $('#' + prefix + 'Confirm');
  const verify = () => {
    confirm.setCustomValidity(confirm.value && confirm.value !== password.value ? '两次输入的密码不一致' : '');
    if (confirm.value && confirm.value !== password.value) formError(form, '两次输入的密码不一致，请重新确认。');
    else formError(form);
    confirm.setAttribute('aria-invalid', String(Boolean(confirm.value && confirm.value !== password.value)));
  };
  password.addEventListener('input', verify); confirm.addEventListener('input', verify);
  form.querySelector('[data-reveal]').onchange = event => {
    password.type = confirm.type = event.target.checked ? 'text' : 'password';
  };
}
async function submitForm(form, action) {
  const button = form.querySelector('[type=submit]');
  if (button.disabled) return;
  button.disabled = true; formError(form);
  try { await action(); }
  catch (error) { formError(form, error.message); }
  finally { if (button.isConnected) button.disabled = false; }
}
function renderAuth(mode = 'login') {
  document.onpaste = null;
  const create = mode !== 'login';
  const title = mode === 'setup' ? '创建管理员' : mode === 'register' ? '创建你的账号' : '欢迎回来';
  const description = mode === 'setup' ? '先设置管理员账号，开启你的本地图片空间。' : mode === 'register' ? '注册后，你只能查看和管理自己上传的图片。' : '登录你的私有图片空间。';
  app.innerHTML = `<main class="auth-wrap"><section class="auth-card"><div class="auth-brand">${logo()}<span>${esc(state.site.siteName || 'CelPic')}</span></div><h1>${title}</h1><p class="muted">${description}</p><form id="authForm">${create ? credentials('auth') : field('authUsername','用户名','text','required autocomplete="username"') + field('authPassword','密码','password','required maxlength="128" autocomplete="current-password"')}<p class="form-error" id="authError" role="alert"></p><button class="btn full" type="submit">${mode === 'setup' ? '创建管理员' : mode === 'register' ? '创建账号' : '登录'}</button></form>${mode === 'register' ? '<button class="text-btn full" id="backLogin">已有账号？返回登录</button>' : mode === 'login' && state.site.registration ? '<button class="text-btn full" id="registerLink">没有账号？立即注册</button>' : ''}<p class="tip">图片保存在你自己的设备，不使用第三方存储。</p></section><span class="auth-footer">CelPic · 让图片回到自己的空间</span></main>`;
  const form = $('#authForm');
  if (create) bindCredentials(form, 'auth');
  form.onsubmit = event => {
    event.preventDefault();
    submitForm(form, async () => {
      if (create) {
        const input = credentialValues('auth');
        if (input.password !== input.passwordConfirm) throw new Error('两次输入的密码不一致');
        await send('/api/' + mode, 'POST', input);
        toast(mode === 'setup' ? '管理员创建成功，请登录' : '注册成功，请登录');
        renderAuth();
      } else {
        await send('/api/login', 'POST', { username: $('#authUsername').value, password: $('#authPassword').value });
        state.user = (await api('/api/me')).user;
        state.selected.clear(); state.tab = 'upload';
        // Keep the rendered screen and URL consistent after authentication.
        const destination = location.pathname === '/login' ? '/' : '/admin';
        history.replaceState({}, '', destination);
        if (destination === '/') publicHome(); else shell();
      }
    });
  };
  if ($('#registerLink')) $('#registerLink').onclick = () => renderAuth('register');
  if ($('#backLogin')) $('#backLogin').onclick = () => renderAuth();
}
function publicHome() {
  document.onpaste = null;
  const logged = !!state.user;
  app.innerHTML = '<main class="public-home"><header class="public-nav"><a class="public-brand" href="/">'+logo()+'<strong>'+esc(state.site.siteName || 'CelPic')+'</strong></a><nav><button class="icon-btn" id="publicTheme" title="切换深色模式" aria-label="切换深色模式">'+icon('moon')+'</button>'+(logged ? '<a class="public-admin" href="/admin" title="进入后台管理">'+icon('settings')+'<span>'+esc(state.user.username)+'</span></a>' : '<button class="btn ghost" id="publicLogin">登录后上传</button>')+'</nav></header><section class="public-hero"><p class="muted public-tagline">本地存储 · 自主掌控</p><input id="publicFileInput" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden><section class="upload-card public-drop" id="publicDrop"><div class="upload-symbol">'+icon('upload')+'</div><div class="upload-description"><h2>'+(logged ? '点击或拖拽上传图片' : '登录后即可上传图片')+'</h2><p class="muted">'+(logged ? '支持拖拽、多选文件，或按 Ctrl + V 粘贴截图' : '访客可以浏览首页，但不会展示其他用户的图片')+'</p><span class="upload-hint">JPG / PNG / GIF / WebP · 单张不超过 '+state.maxUploadMB+' MB</span></div><button class="btn ghost" id="publicChoose">'+(logged ? '选择文件' : '登录后上传')+'</button></section><section id="publicResults" class="upload-results" aria-label="本次上传结果" hidden><div class="upload-results-head"><div><h2>本次上传</h2><span id="publicProgress" class="muted" role="status"></span></div><a class="text-btn" href="/admin">进入后台管理 →</a></div><div id="publicQueue" class="card-grid"></div></section></section><footer class="public-footer">'+esc(state.site.siteName || 'CelPic')+' · 图片只属于你自己</footer></main>';
  $('#publicTheme').onclick=()=>{document.body.classList.toggle('dark');try{localStorage.setItem('dark',String(document.body.classList.contains('dark')))}catch{}};
  const input=$('#publicFileInput'), drop=$('#publicDrop');
  if (!logged) { const goLogin=event=>{ event.stopPropagation(); if (location.pathname !== '/login') history.pushState({view:'login'},'', '/login'); renderAuth(); }; drop.onclick=goLogin; $('#publicLogin').onclick=goLogin; $('#publicChoose').onclick=goLogin; return; } drop.onclick=e=>{if(!e.target.closest('button'))input.click()}; $('#publicChoose').onclick=()=>input.click(); input.onchange=e=>{publicUpload(e.target.files);input.value=''};
  ['dragenter','dragover'].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.add('over')})); ['dragleave','drop'].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.remove('over')})); drop.ondrop=e=>publicUpload(e.dataTransfer.files);
  document.onpaste=e=>{const files=[...(e.clipboardData?.items||[])].filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();publicUpload(files)}};
}
async function publicUpload(files) { const list=[...files]; if(!list.length)return; state.uploads=list.map(file=>({file,status:'pending'})); $('#publicResults').hidden=false; drawPublicUploads(); state.loading=true; let ok=0,fail=0; for(let i=0;i<list.length;i++){state.uploads[i].status='uploading';drawPublicUploads();const form=new FormData();form.append('files',list[i],list[i].name);try{const result=await api('/api/upload',{method:'POST',body:form});state.uploads[i].status='success';state.uploads[i].image=result.images[0];ok++}catch(e){state.uploads[i].status='failed';state.uploads[i].message=e.message;fail++}drawPublicUploads()} state.loading=false;$('#publicProgress').textContent='上传完成：'+ok+' 张成功'+(fail?'，'+fail+' 张失败':''); if(ok)toast('上传成功'); }
function drawPublicUploads(){const q=$('#publicQueue');if(!q)return;q.innerHTML=state.uploads.map(item=>item.status==='success'?'<article class="upload-result-card success"><img src="'+esc(imageHref(item.image.url))+'" alt="'+esc(item.image.original)+'"><div class="upload-result-info"><strong>'+esc(item.image.original)+'</strong><small>'+fmt(item.image.size)+' · 上传成功</small>'+linkControl(item.image,item.format||'url')+'</div></article>':'<article class="upload-result-card '+esc(item.status)+'"><div class="upload-placeholder">'+icon('upload')+'<span>'+esc(item.file.name)+'</span></div><p class="upload-card-message">'+esc(item.message||(item.status==='uploading'?'上传中…':'等待上传'))+'</p></article>').join(''); q.querySelectorAll('.upload-result-card.success').forEach((card,i)=>bindCardActions(card,state.uploads[i].image,f=>{state.uploads[i].format=f;drawPublicUploads()}));}

function shell() {
  const admin = state.user.role === 'admin';
  const tabs = [['upload','upload','上传图片'], ['mine','image','我的图片'], ...(admin ? [['images','folder','图片管理']] : []), ...(admin ? [['storage','disk','存储管理']] : []), ['tokens','key','上传令牌'], ...(admin ? [['users','users','用户管理'], ['settings','settings','系统设置']] : [])];
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand">${logoLink()}</div><div class="side-label">我的工作区</div><nav aria-label="主导航">${tabs.map(([id, image, text]) => `<button class="side-link" data-tab="${id}" title="${text}">${icon(image)}<span>${text}</span></button>`).join('')}</nav><div class="side-bottom"><div class="storage">${icon('disk')}<div><strong>本地存储</strong><small id="storageText">图片由自己保管</small></div></div><button class="profile" id="logout" title="退出登录"><span class="avatar">${esc(state.user.username[0].toUpperCase())}</span><span class="profile-name">${esc(state.user.username)}<small>${admin ? '管理员' : '普通用户'}</small></span>${icon('logout')}</button></div></aside><main class="main"><header class="topbar"><div><div class="eyebrow">私有图片空间</div><h1 id="pageTitle">图片管理</h1><p id="pageSub" class="muted"></p></div><div class="top-actions"><button class="icon-btn" id="theme" title="切换深色模式" aria-label="切换深色模式">${icon('moon')}</button></div></header><div id="content"></div><footer class="workspace-footer"><span>${esc(state.site.siteName || 'CelPic')}</span>本地存储 · 自主掌控</footer></main></div>`;
  document.body.classList.remove('sidebar-collapsed');
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => navigate(button.dataset.tab));
  $('#logout').onclick = async () => {
    if (state.loading) return toast('正在上传，请等待本批完成后退出');
    try { await api('/api/logout', { method:'POST' }); state.user = null; state.images = []; state.selected.clear(); state.uploads = []; await refreshSite(); renderAuth(); }
    catch (error) { toast(error.message); }
  };
  $('#theme').onclick = () => {
    document.body.classList.toggle('dark');
    try { localStorage.setItem('dark', String(document.body.classList.contains('dark'))); } catch {}
  };
  navigate(state.tab);
}
function navigate(tab) {
  if (['images', 'users', 'settings'].includes(tab) && state.user.role !== 'admin') tab = 'mine';
  if (tab !== state.tab) { state.images = []; state.selected.clear(); }
  imageRequest++;
  state.tab = tab; document.onpaste = null; window.scrollTo(0, 0);
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (tab === 'upload') uploadTab();
  else if (tab === 'images' || tab === 'mine') imagesTab();
  else {
    $('#content').innerHTML = '<p class="muted">正在加载…</p>';
    const task = tab === 'users' ? usersTab() : tab === 'settings' ? settingsTab() : tab === 'storage' ? storageTab() : tokensTab();
    task.catch(error => { if (state.tab === tab) $('#content').innerHTML = `<div class="panel form-error">${esc(error.message)}</div>`; });
  }
}
function title(heading, subheading) { $('#pageTitle').textContent = heading; $('#pageSub').textContent = subheading; }
function uploadTab() {
  title('上传图片', '将图片保存到自己的空间，上传后即可复制链接。');
  $('#content').innerHTML = `<input id="fileInput" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden><section class="upload-card" id="drop"><div class="upload-symbol">${icon('upload')}</div><div class="upload-description"><h2>把图片放到这里</h2><p class="muted">拖拽上传，或按 Ctrl + V 粘贴截图</p><span class="upload-hint">JPG / PNG / GIF / WebP · 单张不超过 ${state.maxUploadMB} MB</span></div><button class="btn ghost" id="choose">选择文件</button></section><section id="uploadResults" class="upload-results" aria-label="本次上传结果" hidden><div class="upload-results-head"><div><h2>本次上传</h2><span id="uploadProgress" class="muted" role="status"></span></div><button class="text-btn" id="openGallery">前往我的图片 →</button></div><div id="uploadQueue" class="card-grid" aria-label="文件上传状态"></div><p class="upload-copy-hint muted">点击卡片下方的图标，切换并复制对应格式的链接。</p></section>`;
  const drop = $('#drop');
  drop.onclick = event => { if (event.target.closest('button')) return; $('#fileInput').click(); };
  $('#choose').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = event => { upload(event.target.files); event.target.value = ''; };
  ['dragenter','dragover'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove('over'); }));
  drop.ondrop = event => upload(event.dataTransfer.files);
  document.onpaste = event => {
    const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); upload(files); }
  };
  $('#openGallery').onclick = () => navigate('mine');
  drawUploads(); loadImages();
}
function imagesTab() {
  const all = state.tab === 'images';
  title(all ? '图片管理' : '我的图片', all ? '管理全站用户上传的图片，查看图片归属。' : '仅显示你自己上传的图片，独立管理与分享。');
  $('#content').innerHTML = `<div class="stats-row"><div class="stat"><span>图片总数</span><strong id="statImages">—</strong><small>${all ? '全站用户上传的图片' : '当前账号上传的图片'}</small></div><div class="stat"><span>图片占用</span><strong id="statBytes">—</strong><small>已上传文件的总大小</small></div><div class="stat"><span>已选图片</span><strong id="statSelected">0</strong><small>支持批量复制与删除</small></div></div><div class="collection-head"><h2>图片库 <span id="visibleCount"></span></h2><button class="text-btn" id="refresh">刷新列表</button></div><div class="toolbar"><label class="search">${icon('search')}<input id="search" type="search" aria-label="搜索文件名" placeholder="搜索文件名…"></label><label class="select-all"><input id="selectAll" type="checkbox">全选</label><div class="batch-copy" role="group" aria-label="复制所选图片链接"><button class="btn ghost" data-bulk-copy="url">复制直链</button><button class="btn ghost" data-bulk-copy="html">复制 HTML</button><button class="btn ghost" data-bulk-copy="md">复制 Markdown</button></div><button class="btn danger" id="deleteSelected">删除</button></div><div id="grid" class="grid"></div><nav id="pagination" class="pagination" aria-label="图片分页"></nav>`;
  $('#search').oninput = draw;
  $('#selectAll').onchange = event => { filteredImages().forEach(image => event.target.checked ? state.selected.add(image.id) : state.selected.delete(image.id)); draw(); };
  $('#refresh').onclick = loadImages;
  document.querySelectorAll('[data-bulk-copy]').forEach(button => button.onclick = () => copySelected(button.dataset.bulkCopy));
  $('#deleteSelected').onclick = deleteSelected;
  draw(); loadImages(1);
}
function filteredImages() { const query = ($('#search')?.value || '').toLowerCase(); return state.images.filter(image => image.original.toLowerCase().includes(query)); }
let imageRequest = 0;
function imageScope() { return state.tab === 'images' ? 'all' : 'mine'; }
async function loadImages(page = state.pagination.page || 1) {
  const request = ++imageRequest, user = state.user, scope = imageScope();
  state.pagination.page = page;
  try {
    const data = await api('/api/images?scope=' + scope + '&page=' + page + '&pageSize=' + state.pagination.pageSize);
    if (request !== imageRequest || state.user !== user || scope !== imageScope()) return;
    state.images = data.images; state.pagination = data.pagination || { page, pageSize: 12, total: data.images.length, pages: 1 };
    state.selected = new Set([...state.selected].filter(id => state.images.some(image => image.id === id)));
    const bytes = state.images.reduce((sum, image) => sum + image.size, 0);
    if ($('#storageText')) $('#storageText').textContent = `${state.images.length} 张图片 · ${fmt(bytes)}`;
    draw();
  } catch (error) { if (request === imageRequest && state.user === user) toast(error.message); }
}
function drawPagination() {
  const host = $('#pagination'); if (!host) return;
  const p = state.pagination, buttons = [];
  for (let i = 1; i <= p.pages; i++) {
    if (p.pages > 7 && i > 2 && i < p.pages - 1 && Math.abs(i - p.page) > 1) { if (buttons[buttons.length - 1] !== '…') buttons.push('…'); continue; }
    buttons.push(i);
  }
  host.innerHTML = '<span class="page-summary page-total">共 '+p.total+' 张</span><div class="page-controls"><button class="page-btn" data-page="prev" aria-label="上一页" '+(p.page<=1?'disabled':'')+'>上一页</button>' + buttons.map(i=>i==='…'?'<span class="page-ellipsis">…</span>':'<button class="page-btn '+(i===p.page?'active':'')+'" data-page="'+i+'" aria-label="第 '+i+' 页">'+i+'</button>').join('') + '<button class="page-btn" data-page="next" aria-label="下一页" '+(p.page>=p.pages?'disabled':'')+'>下一页</button></div><label class="page-jump">跳至 <input id="pageJump" type="number" min="1" max="'+p.pages+'" value="'+p.page+'" aria-label="跳转页数"> 页<button class="page-jump-btn" id="pageJumpBtn">确定</button></label>';
  host.querySelectorAll('[data-page]').forEach(btn=>btn.onclick=()=>{const target=btn.dataset.page==='prev'?p.page-1:btn.dataset.page==='next'?p.page+1:Number(btn.dataset.page);if(target>=1&&target<=p.pages)loadImages(target)});
  const jump=()=>{const target=Math.max(1,Math.min(p.pages,Number($('#pageJump').value)||1));loadImages(target)};
  $('#pageJumpBtn').onclick=jump; $('#pageJump').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();jump()}};
}
function draw() {
  const grid = $('#grid'); if (!grid) return;
  const rows = filteredImages();
  $('#statImages').textContent = state.images.length;
  $('#statBytes').textContent = fmt(state.images.reduce((sum, image) => sum + image.size, 0));
  $('#statSelected').textContent = state.selected.size;
  $('#visibleCount').textContent = rows.length;
  drawPagination();
  document.querySelectorAll('[data-bulk-copy], #deleteSelected').forEach(button => button.disabled = state.selected.size === 0);
  $('#selectAll').checked = rows.length > 0 && rows.every(image => state.selected.has(image.id));
  $('#selectAll').indeterminate = rows.some(image => state.selected.has(image.id)) && !$('#selectAll').checked;
  grid.innerHTML = rows.length ? rows.map(image => `<article data-image-id="${esc(image.id)}" class="image-card ${state.selected.has(image.id) ? 'selected' : ''}"><label class="check"><input type="checkbox" aria-label="选择 ${esc(image.original)}" ${state.selected.has(image.id) ? 'checked' : ''} data-id="${esc(image.id)}"></label><div class="image-preview"><a class="image-preview-link" data-preview="${esc(image.id)}" href="${esc(imageHref(image.url))}" title="查看图片"><img class="image-backdrop" src="${esc(imageHref(image.url))}" alt="" aria-hidden="true" loading="lazy"><img class="image-main" src="${esc(imageHref(image.url))}" alt="${esc(image.original)}" loading="lazy"></a>${cardActions(null, true)}</div></article>`).join('') : `<div class="empty">${icon('image')}<h3>${$('#search').value ? '没有找到匹配的图片' : '这里，还差你的第一张图片'}</h3><p class="muted">${$('#search').value ? '试试其他文件名，或清空搜索条件。' : '前往左侧「上传图片」，开始整理自己的图片空间。'}</p></div>`;
  grid.querySelectorAll('input[data-id]').forEach(input => input.onchange = () => { input.checked ? state.selected.add(input.dataset.id) : state.selected.delete(input.dataset.id); draw(); });
  grid.querySelectorAll('[data-preview]').forEach(link => link.onclick = event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); previewImage(state.images.find(image => image.id === link.dataset.preview));
  });
  grid.querySelectorAll('[data-image-id]').forEach(card => bindCardActions(card, state.images.find(image => image.id === card.dataset.imageId))); 
}
const linkFormats = [['url', '直链'], ['html', 'HTML'], ['md', 'Markdown']];
function imageLink(image, format) {
  const url = imageHref(image.url);
  const name = image.original.replace(/[\[\]\\\r\n]/g, '_').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return format === 'md' ? `![${name}](${url})` : format === 'html' ? `<img src="${esc(url)}" alt="${esc(image.original)}">` : url;
}
function cardActions(activeFormat = null, removable = false) {
  const symbols = { url:'link', html:'code', md:'markdown' };
  return `<div class="card-actions" role="group" aria-label="图片操作">${linkFormats.map(([format, label]) => `<button type="button" class="card-action ${activeFormat === format ? "active" : ""}" data-card-format="${format}" aria-label="复制${label}链接" ${activeFormat ? `aria-pressed="${activeFormat === format}"` : ""}>${icon(symbols[format])}</button>`).join("")}${removable ? `<button type="button" class="card-action delete-action" data-card-delete aria-label="删除图片">${icon("trash")}</button>` : ""}</div>`;
}
function linkControl(image, format = 'url') {
  const label = linkFormats.find(([key]) => key === format)[1];
  return `<div class="link-control"><input class="card-link" type="text" readonly aria-label="${label}链接" spellcheck="false" value="${esc(imageLink(image, format))}">${cardActions(format)}</div>`;
}
function bindCardActions(container, image, onFormat) {
  container.querySelectorAll('[data-card-format]').forEach(button => button.onclick = () => {
    const format = button.dataset.cardFormat;
    const field = container.querySelector('.card-link');
    if (field) {
      field.value = imageLink(image, format);
      field.setAttribute('aria-label', linkFormats.find(([key]) => key === format)[1] + '链接');
      container.querySelectorAll('[data-card-format]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active));
      });
    }
    if (onFormat) onFormat(format);
    copyText(imageLink(image, format), linkFormats.find(([key]) => key === format)[1] + '链接'); const originalIcon = button.innerHTML; const originalLabel = button.getAttribute('aria-label'); button.innerHTML = icon('check'); button.classList.add('copied'); button.setAttribute('aria-label', '已复制' + linkFormats.find(([key]) => key === format)[1] + '链接'); clearTimeout(button._copyTimer); button._copyTimer = setTimeout(() => { button.innerHTML = originalIcon; button.classList.remove('copied'); button.setAttribute('aria-label', originalLabel); }, 1600);
  });
  const field = container.querySelector('.card-link');
  if (field) field.onclick = () => field.select();
  const remove = container.querySelector('[data-card-delete]');
  if (remove) remove.onclick = () => confirmDelete([image.id]);
}
function drawUploads() {
  const panel = $('#uploadResults'); if (!panel) return;
  panel.hidden = !state.uploads.length;
  if (panel.hidden) return;
  const complete = state.uploads.filter(item => item.status === 'success');
  const failed = state.uploads.filter(item => item.status === 'failed').length;
  $('#uploadProgress').textContent = state.loading ? `正在上传 · ${complete.length + failed} / ${state.uploads.length}` : `上传完成：${complete.length} 张成功${failed ? `，${failed} 张失败` : ""}`;
  const queue = $('#uploadQueue');
  // Only replace cards whose upload state changed; keep copied format and keyboard focus on completed cards.
  state.uploads.forEach((item, index) => {
    let card = queue.children[index];
    if (!card) { card = document.createElement('article'); queue.append(card); }
    const revision = JSON.stringify([item.name, item.status, item.message, item.image?.id]);
    if (card.dataset.revision === revision) return;
    card.dataset.revision = revision;
    card.className = 'image-card upload-result-card ' + item.status;
    card.setAttribute('aria-label', item.name);
    card.innerHTML = `${item.image ? `<a class="image-preview" href="${esc(imageHref(item.image.url))}" data-upload-preview title="查看图片"><img src="${esc(imageHref(item.image.url))}" alt="${esc(item.name)}" loading="lazy"></a>` : `<div class="image-preview upload-placeholder">${icon("image")}<span>${item.status === "failed" ? "上传失败" : item.message}</span></div>`}<div class="image-info"><strong title="${esc(item.name)}">${esc(item.name)}</strong><small>${fmt(item.size)} <span>·</span> <span class="upload-file-status">${item.status === "failed" ? "上传失败" : esc(item.message)}</span></small>${item.image ? linkControl(item.image, item.format) : `<p class="upload-card-message ${item.status === "failed" ? "form-error" : "muted"}">${esc(item.status === "failed" ? item.message : "上传完成后可复制链接")}</p>`}</div>`;
    if (item.image) {
      bindCardActions(card, item.image, format => { item.format = format; });
      card.querySelector('[data-upload-preview]').onclick = event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); previewImage(item.image);
      };
    }
  });
  while (queue.children.length > state.uploads.length) queue.lastElementChild.remove();
  panel.querySelector('.upload-copy-hint').hidden = !complete.length;
}
async function upload(files) {
  const list = [...(files || [])]; if (!list.length) return;
  if (list.length > state.maxUploadCount) return toast('单次最多上传 ' + state.maxUploadCount + ' 张图片');
  if (state.loading) return toast('正在上传，请等待本批完成');
  state.loading = true;
  const batch = list.map(file => ({ name: file.name || 'pasted.png', size: file.size, status: 'waiting', message: '等待上传', format: 'url' }));
  state.uploads = batch;
  drawUploads();
  let success = 0;
  const failures = [];
  for (let index = 0; index < list.length; index++) {
    const file = list[index], item = batch[index];
    item.status = 'uploading'; item.message = '正在上传…'; drawUploads();
    try {
      if (file.size > state.maxUploadMB * 1024 * 1024) throw new Error('超过单张大小限制');
      const form = new FormData(); form.append('files', file, item.name);
      const result = await api('/api/upload', { method:'POST', body:form });
      if (!result.images?.length) throw new Error(result.errors?.join('；') || '上传失败');
      item.image = result.images[0]; item.status = 'success'; item.message = '上传成功';
      success++;
    } catch (error) {
      item.status = 'failed'; item.message = error.message; failures.push(item.name + '：' + error.message);
    }
    drawUploads();
  }
  state.loading = false; drawUploads();
  toast(success ? '已上传 ' + success + ' 张图片' + (failures.length ? '，另有 ' + failures.length + ' 张失败' : '') : failures[0]);
  await loadImages();
}
function copySelected(format) {
  const rows = state.images.filter(image => state.selected.has(image.id));
  if (rows.length) copyText(rows.map(image => imageLink(image, format)).join('\n'));
}
function previewImage(image) {
  if (!image) return;
  const modal = dialog(`<h2>${esc(image.original)}</h2><div class="preview-stage"><img src="${esc(imageHref(image.url))}" alt="${esc(image.original)}"></div><div class="preview-meta"><span class="muted">${fmt(image.size)} · ${date(image.created_at)}</span><a href="${esc(imageHref(image.url))}" target="_blank" rel="noopener">打开原图 ↗</a></div><div class="preview-links">${linkControl(image)}</div>`, '图片预览与链接');
  modal.classList.add('image-modal');
  bindCardActions(modal, image);
}
function dialog(content, label) {
  const previous = document.activeElement;
  const element = document.createElement('dialog'); element.className = 'modal'; element.setAttribute('aria-label', label);
  element.innerHTML = `<button type="button" class="icon-btn close" aria-label="关闭">${icon('close')}</button>${content}`;
  document.body.append(element);
  element.querySelector('.close').onclick = () => element.close();
  element.addEventListener('close', () => { element.remove(); if (previous?.isConnected) previous.focus(); });
  element.showModal();
  return element;
}
function deleteSelected() { confirmDelete([...state.selected]); }
function confirmDelete(ids) {
  if (!ids.length) return;
  if (ids.length > 100) return toast('一次最多删除 100 张图片，请减少选择');
  const scope = imageScope();
  const modal = dialog(`<div class="delete-dialog-head"><span class="delete-dialog-icon">${icon('trash')}</span><div><h2>删除 ${ids.length} 张图片？</h2><p>文件将从本地磁盘永久删除，已有直链也会失效。</p></div></div><div class="delete-warning">此操作无法撤销，请确认你不再需要这些图片。</div><form id="deleteForm"><p class="form-error" role="alert"></p><div class="delete-dialog-actions"><button class="btn ghost" type="button" id="cancelDelete">取消</button><button class="btn danger" type="submit">确认删除</button></div></form>`, '确认删除图片'); modal.classList.add('delete-modal'); modal.querySelector('#cancelDelete').onclick = () => modal.close();
  const form = $('#deleteForm'); form.onsubmit = event => {
    event.preventDefault(); submitForm(form, async () => {
      await send('/api/images?scope=' + scope, 'DELETE', { ids });
      ids.forEach(id => state.selected.delete(id)); state.uploads = state.uploads.filter(item => !item.image || !ids.includes(item.image.id)); drawUploads(); modal.close(); toast('所选图片已删除'); await loadImages();
    });
  };
}
async function storageTab() {
  title('存储管理', '管理本地磁盘和 S3 兼容对象存储，新上传可选择默认后端。');
  const data = await api('/api/storage-backends'); if (state.tab !== 'storage') return;
  const cards = data.backends.map(b => {
    const driver = b.driver === 'local' ? '本地磁盘' : ({r2:'Cloudflare R2',s3:'Amazon S3',cos:'腾讯云 COS',oss:'阿里云 OSS'}[b.driver] || 'S3 兼容');
    const total = b.totalBytes == null ? '按量/未设置' : fmt(b.totalBytes);
    const used = fmt(b.usedBytes ?? b.bytes ?? 0);
    const remaining = b.remainingBytes == null ? '—' : fmt(b.remainingBytes);
    const ratio = b.totalBytes ? Math.min(100, Math.max(0, (b.usedBytes ?? b.bytes ?? 0) / b.totalBytes * 100)) : 0;
    return '<article class="storage-card '+(b.is_default?'is-default':'')+'"><div class="storage-card-head"><div class="storage-icon">'+icon(b.driver==='local'?'disk':'cloud')+'</div><div class="storage-title"><h3>'+esc(b.name)+'</h3><p>'+driver+(b.bucket?' · '+esc(b.bucket):'')+'</p></div><div class="storage-badges">'+(b.enabled?'<span class="status-pill">已启用</span>':'<span class="status-pill muted-pill">已停用</span>')+(b.is_default?'<span class="default-pill">默认</span>':'')+'</div></div><div class="storage-metrics storage-capacity-metrics"><div><span>总容量</span><strong>'+total+'</strong></div><div><span>已用</span><strong>'+used+'</strong></div><div><span>剩余</span><strong>'+remaining+'</strong></div></div><div class="storage-usage"><div><span>使用量'+(b.totalBytes == null?'（索引统计）':'')+'</span><b>'+ (b.totalBytes == null ? used : ratio.toFixed(2)+'%') +'</b></div><div class="usage-track"><i style="width:'+(b.totalBytes ? Math.max(ratio, used !== '0 B' ? 1 : 0) : 0)+'%"></i></div></div><div class="storage-actions"><button class="btn ghost" data-storage-test="'+esc(b.id)+'">测试连接</button><button class="btn ghost" data-storage-edit="'+esc(b.id)+'">编辑</button>'+(b.id==='local'?'':'<button class="btn danger" data-storage-delete="'+esc(b.id)+'">删除</button>')+'</div></article>';
  }).join('');
  $('#content').innerHTML='<section class="storage-shell"><div class="storage-shell-head"><div><h2>存储管理</h2><p class="muted">查看每个存储的总容量、已用空间和剩余空间。云存储容量按服务商实际配额计算。</p></div><div class="storage-head-actions"><button class="btn ghost" id="refreshStorage">'+icon('refresh')+'刷新统计</button><button class="btn action-btn" id="addStorage">'+icon('plus')+'添加存储</button></div></div><div class="storage-grid">'+cards+'</div></section><div id="storageDialogHost"></div>';
  $('#addStorage').onclick=()=>storageDialog(); $('#refreshStorage').onclick=()=>storageTab(); document.querySelectorAll('[data-storage-test]').forEach(b=>b.onclick=async()=>{b.disabled=true;b.textContent='测试中…';try{const result=await send('/api/storage-backends?action=test','POST',{id:b.dataset.storageTest});toast(result.message||'连接测试成功')}catch(e){toast('连接测试失败：'+e.message)}finally{b.disabled=false;b.textContent='测试连接'}}); document.querySelectorAll('[data-storage-edit]').forEach(b=>b.onclick=()=>storageDialog(data.backends.find(x=>x.id===b.dataset.storageEdit))); document.querySelectorAll('[data-storage-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('确定删除这个存储后端吗？'))return;try{await send('/api/storage-backends','DELETE',{id:b.dataset.storageDelete});toast('存储已删除');storageTab()}catch(e){toast(e.message)}});
}
function storageDialog(item = {}) {
  const edit = Boolean(item.id);
  const modal = dialog(
    '<h2>' + (edit ? '编辑存储' : '添加存储') + '</h2>' +
    '<p class="muted">兼容 R2、AWS S3、腾讯云 COS 和阿里云 OSS。</p>' +
    '<form id="storageForm" class="storage-form">' +
      '<div class="storage-form-grid compact-grid">' +
        '<label class="field"><span>名称</span><input id="storageName" required maxlength="60" value="' + esc(item.name || '') + '" placeholder="例如：Cloudflare R2"></label>' +
        '<label class="field"><span>类型</span><select id="storageDriver"><option value="s3">S3 兼容</option><option value="r2">Cloudflare R2</option><option value="cos">腾讯云 COS</option><option value="oss">阿里云 OSS</option></select></label>' +
        '<label class="field storage-cloud-field"><span>Endpoint</span><input id="storageEndpoint" value="' + esc(item.endpoint || '') + '" placeholder="https://..."></label>' +
        '<label class="field storage-cloud-field"><span>Region</span><input id="storageRegion" value="' + esc(item.region || '') + '" placeholder="auto"></label>' +
        '<label class="field storage-cloud-field"><span>Bucket</span><input id="storageBucket" value="' + esc(item.bucket || '') + '"></label>' +
        '<label class="field storage-cloud-field"><span>Access Key</span><input id="storageAccess" value="' + esc(item.access_key || '') + '"></label>' +
        '<label class="field storage-cloud-field"><span>Secret Key</span><input id="storageSecret" type="password" placeholder="' + (edit ? '留空表示不修改' : '填写密钥') + '"></label>' +
        '<label class="field storage-cloud-field"><span>公开访问域名（可选）</span><input id="storagePublic" value="' + esc(item.public_url || '') + '" placeholder="https://cdn.example.com"></label>' +
      '</div>' +
      '<div class="storage-options"><label class="checkbox-line"><input id="storageDefault" type="checkbox" ' + (item.is_default ? 'checked' : '') + '>设为默认上传存储</label><label class="checkbox-line"><input id="storagePublicMode" type="checkbox" ' + (item.access_mode === 'public' ? 'checked' : '') + '>使用公开 CDN 直链（否则走代理）</label></div>' +
      '<p class="form-error" id="storageError" role="alert"></p>' +
      '<button class="btn full" type="submit">' + (edit ? '保存修改' : '添加存储') + '</button>' +
    '</form>',
    edit ? '编辑存储' : '添加存储'
  );
  modal.classList.add('storage-user-modal');
  if (item.driver === 'local') { $('#storageDriver').insertAdjacentHTML('beforeend', '<option value="local">本地磁盘（系统内置）</option>'); $('#storageDriver').disabled = true; }
  $('#storageDriver').value = item.driver || 's3';
  const cloudFields = [...modal.querySelectorAll('.storage-cloud-field')];
  const driverHint = document.createElement('p');
  driverHint.className = 'storage-driver-hint muted';
  $('#storageDriver').closest('.field').append(driverHint);
  const updateDriver = () => {
    const local = $('#storageDriver').value === 'local';
    cloudFields.forEach(field => { field.hidden = local; field.querySelectorAll('input').forEach(input => { input.disabled = local; }); });
    $('#storagePublicMode').disabled = local;
    if (local) {
      driverHint.textContent = '本地磁盘不需要 Endpoint、Bucket 或密钥，图片会保存到 CelPic 的 storage 目录。';
      if (!$('#storageName').value || $('#storageName').value === 'Cloudflare R2') $('#storageName').value = '本地磁盘';
      $('#storageDefault').checked = true;
      $('#storagePublicMode').checked = false;
    } else {
      driverHint.textContent = '云存储需要从服务商控制台获取 Endpoint、Bucket、Access Key 和 Secret Key。';
    }
  };
  $('#storageDriver').onchange = updateDriver;
  updateDriver();
  $('#storageForm').onsubmit = async event => {
    event.preventDefault();
    const button = $('#storageForm button[type="submit"]');
    button.disabled = true;
    try {
      const body = { id: item.id, name: $('#storageName').value, driver: $('#storageDriver').value, endpoint: $('#storageEndpoint').value, region: $('#storageRegion').value, bucket: $('#storageBucket').value, access_key: $('#storageAccess').value, secret_key: $('#storageSecret').value, public_url: $('#storagePublic').value, access_mode: $('#storagePublicMode').checked ? 'public' : 'proxy', is_default: $('#storageDefault').checked };
      await send('/api/storage-backends', edit ? 'PUT' : 'POST', body);
      modal.close(); toast('存储配置已保存'); await storageTab();
    } catch (error) { formError($('#storageForm'), error.message); button.disabled = false; }
  };
}
async function usersTab() {
  title('用户管理', '为家人或朋友创建账号，分开管理各自的图片。');
  const data = await api('/api/users'); if (state.tab !== 'users') return;
  $('#content').innerHTML = `<section class="panel"><div class="panel-head"><div><h2>全部用户 <span class="count-badge">${data.users.length}</span></h2><p class="muted">管理员可管理全部图片，普通用户只能管理自己的图片。</p></div><button class="btn" id="addUser">添加用户</button></div><div class="table-scroll"><table><thead><tr><th>用户</th><th>角色</th><th>创建日期</th></tr></thead><tbody>${data.users.map(user => `<tr><td><div class="user-cell"><span class="avatar mini">${esc(user.username[0].toUpperCase())}</span><strong>${esc(user.username)}</strong>${user.id === state.user.id ? '<span class="muted">（你）</span>' : ''}</div></td><td><span class="pill ${user.role === 'admin' ? '' : 'neutral'}">${user.role === 'admin' ? '管理员' : '普通用户'}</span></td><td class="muted">${date(user.createdAt)}</td></tr>`).join('')}</tbody></table></div></section>`;
  $('#addUser').onclick = () => {
    const modal = dialog(`<h2>添加用户</h2><p class="muted">为新账号设置密码，并再次输入确认。</p><form id="userForm">${credentials('newUser')}<label class="field"><span>账号角色</span><select id="newRole"><option value="user">普通用户</option><option value="admin">管理员（可管理整个站点）</option></select></label><p class="form-error" id="newUserError" role="alert"></p><button type="submit" class="btn full">创建用户</button></form>`, '添加用户');
    const form = $('#userForm'); bindCredentials(form, 'newUser');
    form.onsubmit = event => { event.preventDefault(); submitForm(form, async () => {
      const input = credentialValues('newUser');
      if (input.password !== input.passwordConfirm) throw new Error('两次输入的密码不一致');
      await send('/api/users', 'POST', { ...input, role: $('#newRole').value });
      modal.close(); toast('用户创建成功'); await usersTab();
    }); };
  };
}
function toggle(id, label, description, checked) {
  return `<label class="setting-row" for="${id}"><div><strong>${label}</strong><p class="muted">${description}</p></div><input class="switch" id="${id}" type="checkbox" ${checked ? 'checked' : ''}></label>`;
}
async function settingsTab() {
  title('系统设置', '管理站点外观、注册权限和图片存储方式。');
  const data = await api('/api/settings'); if (state.tab !== 'settings') return;
  const s = data.settings; let logoId = s.logoImageId;
  $('#content').innerHTML = `<form id="settingsForm" class="settings-form"><section class="panel"><h2>站点与访问</h2><div class="origin-grid"><label class="field"><span>网站域名</span><input id="adminOrigin" value="${esc(s.adminOrigin || '')}" placeholder="留空使用当前后台地址，例如 https://admin.example.com"></label><label class="field"><span>图片域名</span><input id="imageOrigin" value="${esc(s.imageOrigin || '')}" placeholder="留空使用默认图片端口，例如 https://img.example.com"></label></div><p class="muted">本地默认使用后台 1018、图片 23133；填写两个域名并保存后，新生成的图片链接会自动使用图片域名。域名需包含 http:// 或 https://。</p>${field('siteName','站点名称','text',`required maxlength="40" value="${esc(s.siteName)}"`)}<div class="upload-limit-grid"><label class="field"><span>单张图片大小上限（MB）</span><input id="maxUploadMB" type="number" min="1" max="512" step="1" value="${Number(s.maxUploadMB || 20)}"><small class="muted">范围 1–512 MB</small></label><label class="field"><span>单次最多上传数量</span><input id="maxUploadCount" type="number" min="1" max="100" step="1" value="${Number(s.maxUploadCount || 20)}"><small class="muted">范围 1–100 张</small></label></div><div class="setting-row"><div><strong>自定义 Logo</strong><p class="muted">使用 JPG、PNG、GIF 或 WebP。图片将保存在本站。</p></div><div class="logo-controls"><span id="logoPreview">${logo()}</span><input id="logoFile" type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden><button type="button" class="btn ghost" id="chooseLogo">选择图片</button><button type="button" class="text-btn" id="resetLogo">重置</button></div></div>${toggle('registration','开放注册','默认关闭。开启后登录页将显示注册入口。',s.registration)}</section><section class="panel"><h2>本地目录与直链</h2><p class="muted">目录设置只影响之后上传的文件；已有图片不搬动，旧直链继续可用。</p>${field('storageSubdir','存储子目录','text',`maxlength="120" placeholder="留空表示根目录，或填写 0" value="${esc(s.storageSubdir)}"`)}${toggle('flatStorage','扁平化存储','不按年 / 月分组，统一写入指定子目录。',s.flatStorage)}${toggle('hidePathPrefix','隐藏直链目录前缀','生成的链接不包含 images/ 前缀。与磁盘存储目录独立。',s.hidePathPrefix)}${toggle('hideDate','隐藏直链日期','链接只保留随机文件名，不包含年 / 月。',s.hideDate)}<div class="path-preview"><span>磁盘位置示例（容器内）</span><code id="diskPreview"></code><span>直链格式示例</span><code id="urlPreview"></code></div></section><section class="panel"><h2>Referer 防盗链</h2><p class="muted">减少第三方网站引用；不是私密访问控制，知道直链的人仍可能获取图片。</p>${toggle('refererProtection','启用防盗链','允许本站和下方域名引用图片。',s.refererProtection)}<label class="field"><span>允许引用的域名（一行一个，不含协议）</span><textarea id="allowedReferers" rows="3" placeholder="blog.example.com">${esc(s.allowedReferers)}</textarea></label>${toggle('allowEmptyReferer','允许空 Referer','开启后允许直接打开链接。部分客户端也不发送 Referer。',s.allowEmptyReferer)}</section><div class="settings-save"><p class="form-error" role="alert"></p><button class="btn" type="submit">保存设置</button></div></form>`;
  const preview = () => {
    const sampleDate = new Date().toISOString().slice(0,7).replace('-', '/') + '/';
    $('#diskPreview').textContent = '/data/images/' + ($('#storageSubdir').value ? $('#storageSubdir').value + '/' : '') + ($('#flatStorage').checked ? '' : sampleDate) + '随机文件名.webp';
    $('#urlPreview').textContent = location.origin + '/' + ($('#hidePathPrefix').checked ? '' : 'images/') + ($('#hideDate').checked ? '' : sampleDate) + '随机文件名.webp';
  };
  ['storageSubdir','flatStorage','hidePathPrefix','hideDate'].forEach(id => $('#' + id).oninput = preview); preview();
  $('#chooseLogo').onclick = () => $('#logoFile').click();
  $('#logoFile').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    const button = $('#chooseLogo'), save = $('#settingsForm [type=submit]'); button.disabled = save.disabled = true;
    try {
      if (file.size > state.maxUploadMB * 1024 * 1024) throw new Error('Logo 超过单张大小限制');
      const form = new FormData(); form.append('files', file);
      const result = await api('/api/upload', { method:'POST', body:form });
      logoId = result.images[0].id;
      if ($('#logoPreview')) $('#logoPreview').innerHTML = `<img class="brand-icon custom-logo" src="${esc(result.images[0].url)}" alt="Logo 预览">`;
      toast('Logo 已上传，保存设置后生效');
    } catch (error) { toast(error.message); }
    finally { button.disabled = save.disabled = false; }
  };
  $('#resetLogo').onclick = () => {
    logoId = '';
    $('#logoPreview').innerHTML = '<span class="brand-icon">c<span class="logo-dot">.</span></span>';
    toast('已恢复默认 Logo，请点击保存设置');
  };
  const form = $('#settingsForm'); form.onsubmit = event => {
    event.preventDefault(); submitForm(form, async () => {
      const value = { siteName: $('#siteName').value, maxUploadMB: Number($('#maxUploadMB').value), maxUploadCount: Number($('#maxUploadCount').value), storageSubdir: $('#storageSubdir').value, allowedReferers: $('#allowedReferers').value, logoImageId: logoId };
      for (const id of ['registration','flatStorage','hidePathPrefix','hideDate','refererProtection','allowEmptyReferer']) value[id] = $('#' + id).checked;
      await send('/api/settings', 'PUT', value); await refreshSite(); toast('设置已保存'); shell();
    });
  };
}
async function tokensTab() {
  title('上传令牌', '让脚本或上传工具将图片发送到你自己的 CelPic。');
  const data = await api('/api/tokens'); if (state.tab !== 'tokens') return;
  const expiry = token => token.expiresAt ? '到期：' + date(token.expiresAt) : '永不过期';
  const rows = data.tokens.map(token => '<div class="token-row"><div><strong>' + esc(token.label) + '</strong><small><code>' + esc(token.hint) + '…</code> · ' + date(token.createdAt) + ' · ' + expiry(token) + '<br>权限：仅上传' + (token.lastUsedAt ? ' · 最后使用：' + date(token.lastUsedAt) : '') + '</small></div><button class="btn danger" data-revoke="' + esc(token.id) + '">撤销</button></div>').join('');
  $('#content').innerHTML = '<section class="panel"><div class="panel-head"><div><h2>个人上传令牌</h2><p class="muted">仅可用于上传，不能调用管理接口。完整令牌只显示一次，请妥善保管。</p></div></div><form id="tokenForm" class="token-create">' + field('tokenLabel','令牌名称','text','required maxlength="40" placeholder="例如：笔记软件"') + '<label class="field"><span>有效期</span><select id="tokenExpiry"><option value="never">永不过期</option><option value="7d">7 天</option><option value="30d">30 天</option><option value="90d">90 天</option><option value="365d">365 天</option></select></label><button type="submit" class="btn">创建令牌</button><p class="form-error" role="alert"></p></form><div class="token-list">' + (rows || '<p class="muted">暂无令牌。仅在需要外部工具上传时创建。</p>') + '</div><div class="api-note"><strong>CelPic 原生上传接口</strong><code>POST /api/upload</code><p class="muted">请求头：Authorization: Bearer 你的令牌<br>请求体：multipart/form-data，文件字段为 files。无需兰空图床服务。</p></div></section>';
  const form = $('#tokenForm'); form.onsubmit = event => {
    event.preventDefault(); submitForm(form, async () => {
      const result = await send('/api/tokens','POST',{ label: $('#tokenLabel').value, expiresIn: $('#tokenExpiry').value });
      await tokensTab();
      const modal = dialog('<h2>保存你的上传令牌</h2><p class="muted">关闭后无法再次查看完整内容。可以随时撤销并重新创建。</p><textarea id="tokenSecret" rows="3" readonly aria-label="上传令牌">' + esc(result.token) + '</textarea><button type="button" class="btn full" id="copyToken">复制令牌</button>', '上传令牌');
      modal.querySelector('#copyToken').onclick = () => copyText(result.token);
    });
  };
  document.querySelectorAll('[data-revoke]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try { await api('/api/tokens/' + button.dataset.revoke, { method:'DELETE' }); toast('令牌已撤销'); await tokensTab(); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
}
async function refreshSite() {
  const status = await api('/api/status'); state.site = status.site; state.maxUploadMB = status.maxUploadMB; state.maxUploadCount = status.maxUploadCount || 20;
  document.title = state.site.siteName || 'CelPic';
  const favicon = document.querySelector('link[rel=\"icon\"]');
  if (favicon) favicon.href = state.site.logoUrl || '/favicon.svg';
  return status;
}
window.addEventListener('popstate', () => {
  if (location.pathname === '/login') renderAuth();
  else if (location.pathname === '/admin') { if (state.user) shell(); else renderAuth(); }
  else publicHome();
});
(async () => {
  try {
    try { if (localStorage.getItem('dark') === 'true') document.body.classList.add('dark'); } catch {}
    const status = await refreshSite();
    if (status.setup) return renderAuth('setup');
    try { state.user = (await api('/api/me')).user; } catch { state.user = null; }
    if (location.pathname === '/admin') { if (state.user) shell(); else renderAuth(); } else if (location.pathname === '/login') renderAuth(); else publicHome();
  } catch (error) {
    app.innerHTML = `<main class="auth-wrap"><section class="auth-card"><h1>暂时无法连接 CelPic</h1><p class="form-error">${esc(error.message)}</p><p class="muted">请确认服务正在运行，然后刷新页面。</p></section></main>`;
  }
})();






