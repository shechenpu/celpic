'use strict';
// Optional UI regression test. Set PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE
// when using a bundled Playwright installation and an existing local browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'celpic-ui-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: ['ignore','pipe','pipe'],
    env: { ...process.env, PORT:'0', HOST:'127.0.0.1', DATA_DIR:path.join(temporary,'data'), CELPIC_STORAGE_DIR:path.join(temporary,'images') },
  });
  let browser;
  try {
    const origin = await new Promise((resolve, reject) => {
      let log = '';
      const timeout = setTimeout(() => reject(new Error('Startup timeout: ' + log)), 10_000);
      server.stdout.on('data', chunk => {
        log += chunk;
        const match = log.match(/listening on :(\d+)/);
        if (match) { clearTimeout(timeout); resolve('http://127.0.0.1:' + match[1]); }
      });
      server.stderr.on('data', chunk => { log += chunk; });
      server.once('error', reject);
    });
    browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath:process.env.BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport:{width:1440,height:1000} });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('#authUsername').fill('测试管理员');
    await page.locator('#authPassword').fill('ui-test-2026');
    await page.locator('#authConfirm').fill('wrong-password');
    await page.getByRole('button',{name:'创建管理员',exact:true}).click();
    assert.match(await page.locator('#authError').innerText(), /不一致/);
    assert.equal((await (await fetch(origin+'/api/status')).json()).setup,true);
    await page.locator('#authConfirm').fill('ui-test-2026');
    await page.getByRole('button',{name:'创建管理员',exact:true}).click();
    await page.getByRole('button',{name:'登录',exact:true}).waitFor();
    await page.locator('#authUsername').fill('测试管理员');
    await page.locator('#authPassword').fill('ui-test-2026');
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await page.locator('#drop').waitFor();
    await page.locator('[data-tab="users"]').click();
    await page.locator('#addUser').click();
    await page.locator('#newUserUsername').fill('普通用户');
    await page.locator('#newUserPassword').fill('ui-test-2026');
    await page.locator('#newUserConfirm').fill('wrong-password');
    await page.getByRole('button',{name:'创建用户',exact:true}).click();
    assert.match(await page.locator('#newUserError').innerText(), /不一致/);
    await page.locator('#newUserConfirm').fill('ui-test-2026');
    await page.getByRole('button',{name:'创建用户',exact:true}).click();
    await page.getByRole('cell',{name:'普通用户',exact:true}).first().waitFor();
    await page.locator('[data-tab="upload"]').click();
    await page.setViewportSize({width:1920,height:1080});
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    const capture = async name => {
      if (!process.env.CELPIC_UI_SCREENSHOTS) return;
      fs.mkdirSync(process.env.CELPIC_UI_SCREENSHOTS, {recursive:true});
      await page.locator('.toast').waitFor({state:'hidden'});
      await page.screenshot({path:path.join(process.env.CELPIC_UI_SCREENSHOTS,name+'.png'),fullPage:await page.locator('dialog[open]').count()===0});
    };
    const centered = async (child,parent) => {
      const a=await page.locator(child).first().boundingBox(), b=await page.locator(parent).boundingBox();
      assert.ok(Math.abs(a.x+a.width/2-b.x-b.width/2)<2,child+' should be centered in '+parent);
    };
    const leftAligned = async (child,parent) => {
      const a=await page.locator(child).first().boundingBox(), b=await page.locator(parent).boundingBox();
      assert.ok(Math.abs(a.x-b.x)<2,child+' should start at the left of '+parent);
    };
    const clipboard = async () => (await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n');
    const checkOverflow = async label => assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');
    assert.equal(await page.locator('#grid,.stats-row,#copyFormat').count(),0);
    assert.ok((await page.locator('#drop').boundingBox()).height>=280);
    const portrait=Buffer.from(await page.evaluate(()=>{
      const c=document.createElement('canvas'); c.width=360; c.height=1280;
      const g=c.getContext('2d'); g.fillStyle='#edf1f8';g.fillRect(0,0,360,1280);
      g.fillStyle='#5266d4';g.fillRect(24,24,312,180);g.fillStyle='#fff';g.font='30px sans-serif';g.fillText('CelPic',48,105);
      for(let y=260;y<1220;y+=85){g.fillStyle='#d7dfee';g.fillRect(32,y,296,48);}
      return c.toDataURL('image/png').split(',')[1];
    }),'base64');
    await page.locator('#fileInput').setInputFiles({name:'长图预览.png',mimeType:'image/png',buffer:portrait});
    await page.waitForFunction(()=>document.querySelector('#uploadProgress')?.textContent==='上传完成：1 张成功');
    await leftAligned('#uploadQueue .image-card','#uploadQueue');
    assert.equal(await page.locator('#uploadQueue .card-link').count(),1);
    const initialCard=page.locator('#uploadQueue .success');
    const directUrl=await initialCard.locator('.card-link').inputValue();
    assert.ok(directUrl.startsWith(origin+'/'));
    await initialCard.locator('[data-card-format="html"]').click();
    assert.equal(await initialCard.locator('.card-link').inputValue(),'<img src="'+directUrl+'" alt="长图预览.png">');
    assert.equal(await clipboard(),await initialCard.locator('.card-link').inputValue());
    await page.locator('#openGallery').click();
    await page.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='1');
    assert.equal(await page.locator('#drop,#uploadResults').count(),0);
    await leftAligned('#grid .image-card','#grid');
    assert.ok((await page.locator('.stats-row').boundingBox()).y<(await page.locator('.toolbar').boundingBox()).y);
    assert.equal(await page.locator('#grid .card-link,#grid textarea,[data-links]').count(),0);
    assert.equal(await page.locator('#grid .card-action').count(),4);
    await capture('gallery-single');
    await page.locator('[data-preview]').first().click();
    await page.locator('.preview-stage img').evaluate(img=>img.decode());
    await centered('.preview-stage img','.preview-stage');
    const imageBounds=await page.locator('.preview-stage img').boundingBox();
    assert.ok(Math.abs(imageBounds.width/imageBounds.height-360/1280)<0.001);
    await page.locator('.image-modal [data-card-format="html"]').click();
    assert.equal(await clipboard(),await page.locator('.image-modal .card-link').inputValue());
    assert.ok(await page.locator('.toast').evaluate(el=>{
      const r=el.getBoundingClientRect();
      return !!el.closest('dialog[open]') && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;
    }),'copy toast must be above modal backdrop');
    await page.screenshot({path:path.join(process.env.CELPIC_UI_SCREENSHOTS || temporary,'modal-toast.png')});
    await capture('centered-preview');
    const raw=await browser.newPage({viewport:{width:1440,height:1000}});
    const imageResponse=await raw.goto(directUrl);
    assert.match(imageResponse.headers()['content-security-policy'],/default-src 'none'/);
    assert.match(imageResponse.headers()['content-security-policy'],/sandbox/);
    await raw.locator('img').evaluate(img=>img.decode());
    assert.ok(await raw.locator('img').evaluate(img=>Math.abs(img.getBoundingClientRect().x+img.getBoundingClientRect().width/2-innerWidth/2)<2));
    assert.deepEqual(Buffer.from(await imageResponse.body()),portrait); await raw.close();
    await page.keyboard.press('Escape'); await page.locator('.image-modal').waitFor({state:'detached'});
    assert.ok(await page.locator('[data-preview]').first().evaluate(el=>el===document.activeElement));
    await page.locator('[data-tab="upload"]').click();
    assert.equal(await page.locator('#uploadQueue .card-link').inputValue(),'<img src="'+directUrl+'" alt="长图预览.png">');
    assert.equal(await page.locator('#uploadQueue [data-card-format="html"]').getAttribute('aria-pressed'),'true');
    // Procedural landscape fixtures keep visual QA independent of the user's private pictures.
    const landscape=async index=>Buffer.from(await page.evaluate(i=>{
      const c=document.createElement('canvas');c.width=720;c.height=400;const g=c.getContext('2d');
      const colors=[['#dce8ec','#b4cbd1','#658d96','#3a626d'],['#f3e4ca','#d6bd9b','#a28569','#655c52'],['#e0e7dc','#bbcab2','#849d82','#4b6d65'],['#dce0ef','#b2bbd7','#7a8dab','#485c7f'],['#f0deda','#d6b8af','#a5817c','#745d69']][i];
      g.fillStyle=colors[0];g.fillRect(0,0,720,400);g.fillStyle='#fff8e0';g.beginPath();g.arc(550,90,36,0,Math.PI*2);g.fill();
      for(let j=1;j<4;j++){g.fillStyle=colors[j];g.beginPath();g.moveTo(0,400);g.lineTo(0,130+j*48);g.bezierCurveTo(220,25+j*40,400,330-j*35,720,115+j*65);g.lineTo(720,400);g.closePath();g.fill();}
      return c.toDataURL('image/png').split(',')[1];
    },index),'base64');
    const names=['图片[1] & <test>.png','山间日落.png','林间远山.png','蓝色海岸.png','傍晚山丘.png'];
    const files=await Promise.all(names.map(async(name,i)=>({name,mimeType:'image/png',buffer:await landscape(i)})));
    files.push({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('<svg></svg>')});
    await page.route('**/api/upload',async route=>{await new Promise(resolve=>setTimeout(resolve,180));await route.continue();});
    await page.locator('#fileInput').setInputFiles(files);
    await page.locator('#uploadQueue .uploading').waitFor();
    await page.locator('[data-tab="images"]').click();
    assert.equal(await page.locator('#uploadQueue').count(),0);
    await page.locator('[data-tab="upload"]').click();
    await page.waitForFunction(()=>document.querySelector('#uploadProgress')?.textContent==='上传完成：5 张成功，1 张失败');
    await page.unroute('**/api/upload');
    assert.equal(await page.locator('#uploadQueue .success').count(),5);
    assert.equal(await page.locator('#uploadQueue .failed').count(),1);
    assert.equal(await page.locator('#uploadQueue .card-link').count(),5);
    assert.equal(await page.locator('#uploadLinks,#uploadResults textarea').count(),0);
    const cards=page.locator('#uploadQueue .success');
    const firstCard=cards.first(), link=await firstCard.locator('.card-link').inputValue();
    const expected={url:link,html:'<img src="'+link+'" alt="图片[1] &amp; &lt;test&gt;.png">',md:'![图片_1_ & &lt;test&gt;.png]('+link+')'};
    for(const format of ['url','html','md']){
      await firstCard.locator('[data-card-format="'+format+'"]').click();
      assert.equal(await firstCard.locator('.card-link').inputValue(),expected[format]);
      assert.equal(await clipboard(),expected[format]);
      assert.equal(await firstCard.locator('[aria-pressed="true"]').count(),1);
      assert.equal(await firstCard.locator('[data-card-format="'+format+'"]').getAttribute('aria-pressed'),'true');
    }
    assert.equal(await cards.nth(1).locator('[data-card-format="url"]').getAttribute('aria-pressed'),'true');
    const firstBounds=await firstCard.boundingBox(), fifthBounds=await cards.nth(4).boundingBox();
    assert.ok(Math.abs(firstBounds.x-fifthBounds.x)<2 && fifthBounds.y>firstBounds.y,'fifth upload card should wrap to the left');
    for(const width of [390,768,1440,1920,2560]){
      await page.setViewportSize({width,height:1000}); await checkOverflow('upload '+width);
      await leftAligned('#uploadQueue .image-card','#uploadQueue');
      assert.ok((await page.locator('#drop').boundingBox()).height>=280);
    }
    await page.setViewportSize({width:1440,height:1000}); await page.evaluate(()=>window.scrollTo(0,0));
    await capture('upload-desktop');
    await page.locator('#theme').click(); await capture('upload-dark');
    await page.setViewportSize({width:390,height:844}); await capture('upload-mobile-dark');
    await page.locator('#theme').click(); await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-tab="images"]').click();
    await page.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='6');
    const galleryCard=page.locator('#grid .image-card').filter({hasText:names[0]});
    for(const format of ['url','html','md']){
      await galleryCard.locator('[data-card-format="'+format+'"]').click();
      assert.equal(await clipboard(),expected[format]);
      assert.equal(await page.locator('dialog').count(),0,'copy should not open a preview');
    }
    assert.equal(await page.locator('#grid .card-link,#grid textarea').count(),0);
    await page.locator('#selectAll').check(); assert.equal(await page.locator('#statSelected').innerText(),'6');
    for(const format of ['url','html','md']){
      await page.locator('[data-bulk-copy="'+format+'"]').click();
      assert.equal((await clipboard()).split('\n').length,6);
    }
    for(const width of [390,768,1440,1920,2560]){
      await page.setViewportSize({width,height:1000}); await checkOverflow('gallery '+width); await leftAligned('#grid .image-card','#grid');
    }
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await capture('gallery-desktop');
    await page.locator('#theme').click();await capture('gallery-dark');
    await page.setViewportSize({width:390,height:844});await capture('gallery-mobile-dark');
    await page.locator('.image-card').filter({hasText:'长图预览.png'}).locator('[data-preview]').click();
    await centered('.preview-stage img','.preview-stage');
    assert.ok(await page.locator('.image-modal').evaluate(el=>el.scrollWidth<=el.clientWidth));
    await page.keyboard.press('Escape');await page.locator('.image-modal').waitFor({state:'detached'});
    await page.locator('#theme').click();await page.setViewportSize({width:1920,height:1080});
    // Single-card deletion must require confirmation and leave the other selections intact.
    await galleryCard.locator('[data-card-delete]').click();
    assert.equal(await page.locator('#statImages').innerText(),'6');
    await page.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});
    assert.equal(await page.locator('#statImages').innerText(),'6');
    await galleryCard.locator('[data-card-delete]').click();
    await page.getByRole('button',{name:'确认永久删除',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='5');
    assert.equal(await page.locator('#statSelected').innerText(),'5');
    await page.locator('[data-tab="upload"]').click();
    assert.equal(await page.locator('#uploadQueue .success').count(),4);
    assert.equal(await page.locator('#uploadQueue .card-link').count(),4);
    await page.locator('[data-tab="images"]').click();
    await page.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='5');
    assert.equal(await page.locator('#statSelected').innerText(),'0');
    await page.locator('#selectAll').check();
    await page.locator('#deleteSelected').click();await page.getByRole('button',{name:'确认永久删除',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='0');
    assert.equal(await page.locator('#statSelected').innerText(),'0');
    assert.equal(await page.locator('#grid .image-card').count(),0);
    await page.locator('[data-tab="upload"]').click();assert.equal(await page.locator('#uploadQueue .card-link').count(),0);
    await page.locator('[data-tab="settings"]').click();
    await page.locator('#settingsForm').waitFor();
    await centered('#settingsForm','#content');
    const settingsBounds=await page.locator('#settingsForm').boundingBox(), contentBounds=await page.locator('#content').boundingBox();
    assert.ok(Math.abs(settingsBounds.width-contentBounds.width)<2);
    await page.evaluate(()=>window.scrollTo(0,0));
    await capture('settings-desktop');
    await page.locator('#registration').check();
    await page.locator('#storageSubdir').fill('0');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    assert.equal((await saved).status(),200);
    await page.waitForFunction(() => document.querySelector('#storageSubdir')?.value === '0');
    await page.locator('#theme').click();
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const guest = await browser.newPage({viewport:{width:390,height:844}});
    guest.on('pageerror',error => errors.push(error.message));
    await guest.goto(origin);
    await guest.locator('#registerLink').click();
    await guest.locator('#authUsername').fill('注册用户');
    await guest.locator('#authPassword').fill('ui-test-2026');
    await guest.locator('#authConfirm').fill('wrong-password');
    await guest.getByRole('button',{name:'创建账号',exact:true}).click();
    assert.match(await guest.locator('#authError').innerText(),/不一致/);
    await guest.locator('#authConfirm').fill('ui-test-2026');
    await guest.getByRole('button',{name:'创建账号',exact:true}).click();
    await guest.getByRole('button',{name:'登录',exact:true}).waitFor();
    // Distinct owners, scoped stats, menu permissions, and stale-response protection.
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-tab="upload"]').click();
    await page.locator('#fileInput').setInputFiles({name:'管理员图片.png',mimeType:'image/png',buffer:portrait});
    await page.waitForFunction(()=>document.querySelector('#uploadProgress')?.textContent==='上传完成：1 张成功');
    await guest.locator('#authUsername').fill('普通用户');
    await guest.locator('#authPassword').fill('ui-test-2026');
    await guest.getByRole('button',{name:'登录',exact:true}).click();
    await guest.locator('#drop').waitFor();
    assert.equal(await guest.locator('[data-tab="images"],[data-tab="users"],[data-tab="settings"]').count(),0);
    await guest.locator('[data-tab="mine"]').click();
    await guest.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='0');
    await guest.locator('[data-tab="upload"]').click();
    await guest.locator('#fileInput').setInputFiles({name:'用户图片.png',mimeType:'image/png',buffer:portrait});
    await guest.waitForFunction(()=>document.querySelector('#uploadProgress')?.textContent==='上传完成：1 张成功');
    await guest.locator('#openGallery').click();
    await guest.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='1');
    assert.equal(await guest.locator('#pageTitle').innerText(),'我的图片');
    assert.equal(await guest.locator('#grid .image-info strong').innerText(),'用户图片.png');
    await page.locator('[data-tab="images"]').click();
    await page.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='2');
    assert.equal(await page.locator('.image-owner').count(),2);
    assert.match(await page.locator('#grid').innerText(),/上传者：普通用户/);
    await page.locator('#selectAll').check();
    await page.locator('[data-tab="mine"]').click();
    await page.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='1');
    assert.equal(await page.locator('#statSelected').innerText(),'0');
    assert.equal(await page.locator('#grid .image-info strong').innerText(),'管理员图片.png');
    assert.equal(await page.locator('.image-owner').count(),0);
    let releaseAll;
    const blocked=new Promise(resolve=>releaseAll=resolve);
    let requested;
    const started=new Promise(resolve=>requested=resolve);
    await page.route('**/api/images?scope=all',async route=>{ requested(); await blocked; await route.continue(); });
    await page.locator('[data-tab="images"]').click(); await started;
    await page.locator('[data-tab="mine"]').click();
    await page.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='1');
    const finished=page.waitForResponse(r=>r.url().endsWith('/api/images?scope=all'));
    releaseAll(); await (await finished).finished();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#statImages').innerText(),'1');
    assert.equal(await page.locator('#grid .image-info strong').innerText(),'管理员图片.png');
    await page.unroute('**/api/images?scope=all');
    await capture('my-images');
    await page.locator('[data-tab="images"]').click();
    await page.waitForFunction(()=>document.querySelector('#statImages')?.textContent==='2');
    await capture('admin-images');
    assert.deepEqual(errors,[]);
    console.log('UI PASS: scoped personal/admin galleries, owner labels, modal toast top layer, stale response isolation, credentials, separate upload/gallery pages, compact format-switch cards, exact clipboard contents, left-aligned grids, single/bulk deletion, centered portrait/raw image, responsive/dark layouts, settings');
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) { const stopped=once(server,'exit'); server.kill(); await stopped; }
    const target=path.resolve(temporary), relative=path.relative(path.resolve(os.tmpdir()),target);
    assert.ok(relative.startsWith('celpic-ui-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    fs.rmSync(target,{recursive:true,force:true});
  }
})().catch(error => { console.error(error); process.exitCode=1; });
