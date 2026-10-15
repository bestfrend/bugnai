const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

// Exercise the actual browser UI with an isolated Supabase HTTP contract double.
// RLS and data constraints are tested against PostgreSQL separately by npm test.
const root = path.resolve(__dirname, '..');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp3':'audio/mpeg','.png':'image/png'};
const server = http.createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try {res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}
  catch {res.writeHead(404).end();}
});
const own='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
async function wait(check) {
  for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25));}
  throw new Error('Timed out waiting for expected app state');
}
async function scenario(browser,mobile){
  const context=await browser.newContext(mobile?{...devices['Pixel 7']} : {});
  const profiles=[{id:other,nickname:'Kitas <img src=x>',created_at:new Date().toISOString()}];
  const recordings=new Map([[other+':1',{slot:1,events:[{key:'w',time:0},{key:'k',time:50}],duration_ms:50,updated_at:new Date().toISOString()}]]);
  let signups=0,refreshes=0,saves=0,failSave=false,profileReads=0;
  const session=()=>({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,user:{id:own,user_metadata:{nickname:'Ritmas'}}});
  await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:''}));
  await context.route('https://hsqsjxnotqpoodvnxecv.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','content-type':'application/json'};
    const reply=(data,status=200)=>route.fulfill({status,headers,body:JSON.stringify(data)});
    if(method==='OPTIONS')return reply(null);
    if(url.pathname==='/auth/v1/signup'){signups++;return reply(session());}
    if(url.pathname==='/auth/v1/token'){refreshes++;return reply(session());}
    assert.equal(req.headers().authorization,'Bearer test-access');
    if(url.pathname==='/rest/v1/profiles'){
      if(method==='POST'){profiles.push(req.postDataJSON());return reply(null,201);}
      const id=url.searchParams.get('id')?.slice(3);
      if(method==='PATCH'){
        assert.equal(id,own);
        Object.assign(profiles.find(p=>p.id===own),req.postDataJSON());
        return reply([profiles.find(p=>p.id===own)]);
      }
      if(!id)profileReads++;
      const data=id?profiles.filter(p=>p.id===id):profiles.slice().sort((a,b)=>a.nickname.localeCompare(b.nickname));
      return reply(data.slice(Number(url.searchParams.get('offset')||0)));
    }
    if(url.pathname==='/rest/v1/performances'){
      if(method==='POST'){
        if(failSave)return reply({code:'temporary_error'},503);
        const item=req.postDataJSON();assert.equal(item.owner_id,own);
        const saved={...item,updated_at:new Date().toISOString()};recordings.set(own+':'+item.slot,saved);saves++;
        return reply([saved],201);
      }
      const owner=url.searchParams.get('owner_id')?.slice(3);
      if(method==='DELETE'){assert.equal(owner,own);recordings.delete(owner+':'+url.searchParams.get('slot').slice(3));return reply(null);}
      return reply([...recordings.entries()].filter(([key])=>key.startsWith(owner+':')).map(([,value])=>value));
    }
    throw new Error('Unexpected HTTP request '+method+' '+url.pathname);
  });
  const page=await context.newPage();
  await page.addInitScript(() => {
    window.audioHits = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      window.audioHits.push(performance.now());
      return start.apply(this, args);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(...args) {
      window.audioHits.push(performance.now());
      return play.apply(this, args);
    };
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.clock.install();
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  assert(await page.locator('#workspace').isHidden());
  assert.equal(await page.locator('#nickname').evaluate(e=>getComputedStyle(e).userSelect),'text');
  await page.locator('#nickname').fill('Ritmas');
  await page.locator('#login-button').click();
  const mine=page.locator(`[data-owner="${own}"]`);
  const theirs=page.locator(`[data-owner="${other}"]`);
  await wait(async()=>await mine.locator('.slot').count()===7);
  assert.equal(signups,1);
  assert.equal(await mine.locator('.slot .primary').count(),7);
  await theirs.locator('summary').click();
  await wait(async()=>await theirs.locator('.slot').count()===7);
  assert.equal(await theirs.locator('.primary,.danger').count(),0);
  assert.equal(await theirs.locator('img').count(),0,'nicknames must be rendered as text');
  assert.equal(await theirs.locator('.member-name').textContent(),'Kitas <img src=x>');
  assert.equal(await page.locator('#refresh-users').count(),0);
  assert.equal(await page.getByText('Paspausk vardą ir išskleisk septynias įrašų vietas.').count(),0);
  assert.equal(await theirs.locator('summary').evaluate(e=>getComputedStyle(e).listStyleType),'none');
  await page.clock.runFor(200);
  await wait(async()=>await theirs.locator('.member-arrow').evaluate(e=>getComputedStyle(e).transform)==='matrix(0, 1, -1, 0, 0, 0)');
  // Browser uploads a real image, and the app rasterizes a small JPEG avatar.
  const png=await page.locator('.drum').first().screenshot();
  await page.locator('#avatar-file').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});
  await wait(()=>!!profiles.find(p=>p.id===own)?.avatar_data);
  await wait(()=>page.locator('#remove-avatar').isEnabled());
  const avatar=profiles.find(p=>p.id===own).avatar_data;
  assert(avatar.startsWith('data:image/jpeg;base64,'));
  assert(avatar.length<=32768);
  assert(await page.locator('#my-avatar img').evaluate(e=>e.naturalWidth===128 && e.naturalHeight===128));
  assert.equal(await mine.locator('.avatar').evaluate(e=>getComputedStyle(e).borderRadius),'50%');
  await page.locator('#avatar-file').setInputFiles({name:'invalid.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await wait(async()=>await page.locator('#status').textContent().then(text=>text.includes('JPG, PNG arba WebP')));
  assert.equal(profiles.find(p=>p.id===own).avatar_data,avatar,'invalid uploads must leave the old avatar intact');
  const ownSlot=n=>mine.locator(`[data-slot="${n}"]`);
  const strike=async key=>{if(mobile)await page.locator('.'+key+'.drum').tap();else await page.locator('.'+key+'.drum').click();};
  await ownSlot(1).getByRole('button',{name:'Įrašyti',exact:true}).click();
  await strike('w');
  assert(await page.locator('.w.drum').evaluate(e=>e.classList.contains('pressed')));
  await page.clock.runFor(250);
  await strike('a');
  await page.clock.runFor(2000); // Silence must not extend the saved duration.
  await page.locator('#finish-recording').click();
  await wait(()=>saves===1);
  await wait(()=>page.locator('#recording-bar').isHidden());
  const first=recordings.get(own+':1');
  assert.deepEqual(first.events.map(e=>e.key),['w','a']);
  assert.equal(first.events[0].time,0);
  assert.equal(first.duration_ms,first.events.at(-1).time);
  assert(first.duration_ms<1000);
  assert(!/smūgi|"key"|"time"/.test(await mine.locator('.slot').allTextContents().then(values=>values.join(' '))));
  // Another device creates a slot and a profile; polling preserves open groups/focus.
  recordings.set(other+':2',{slot:2,events:[{key:'l',time:0}],duration_ms:0,updated_at:new Date().toISOString()});
  profiles.push({id:'33333333-3333-4333-8333-333333333333',nickname:'Naujas',created_at:new Date().toISOString()});
  const summaryNode=await theirs.locator('summary').elementHandle();
  await theirs.locator('summary').focus();
  const beforePoll=profileReads;
  await page.clock.fastForward(30000);
  await wait(()=>profileReads>beforePoll);
  await wait(async()=>await theirs.locator('[data-slot="2"]').getByRole('button',{name:'Atkurti',exact:true}).count()===1);
  assert(await theirs.evaluate(e=>e.open));
  assert(await summaryNode.evaluate(e=>e.isConnected && e===document.activeElement));
  assert.equal(await page.locator('[data-owner="33333333-3333-4333-8333-333333333333"]').count(),1);
  // The 2-minute limit starts on the first note, not when the slot is armed.
  await ownSlot(2).getByRole('button',{name:'Įrašyti',exact:true}).click();
  await page.clock.fastForward(130000);
  assert.equal(saves,1);
  assert(await page.locator('#recording-title').textContent().then(text=>text.includes('Laukiama pirmo smūgio')));
  await strike('k');
  await page.clock.runFor(200);
  await strike('l');
  await page.clock.fastForward(120000);
  await wait(()=>saves===2);
  await wait(()=>page.locator('#recording-bar').isHidden());
  assert.equal(recordings.get(own+':2').duration_ms,recordings.get(own+':2').events.at(-1).time);
  assert(recordings.get(own+':2').duration_ms<1000);
  // A failed replacement preserves the old record, with a retry kept only in RAM.
  const original=JSON.stringify(recordings.get(own+':1'));
  failSave=true;
  await ownSlot(1).getByRole('button',{name:'Perrašyti'}).click();
  await strike('j');
  await page.locator('#finish-recording').click();
  await wait(()=>page.locator('#retry-recording').isVisible());
  assert.equal(JSON.stringify(recordings.get(own+':1')),original);
  failSave=false;
  await page.locator('#retry-recording').click();
  await wait(()=>saves===3);
  await wait(()=>page.locator('#recording-bar').isHidden());
  assert.equal(recordings.get(own+':1').events[0].key,'j');
  // Discard a replacement by reloading; identity and previous saved data survive.
  const replacement=JSON.stringify(recordings.get(own+':1'));
  await ownSlot(1).getByRole('button',{name:'Perrašyti'}).click();
  await strike('d');
  await page.reload();
  await wait(async()=>await mine.locator('.slot').count()===7);
  assert(await page.locator('#recording-bar').isHidden());
  assert.equal(signups,1);
  assert.equal(saves,3);
  assert.equal(JSON.stringify(recordings.get(own+':1')),replacement);
  // Empty attempts do not create database records.
  await ownSlot(3).getByRole('button',{name:'Įrašyti',exact:true}).click();
  await page.locator('#finish-recording').click();
  assert.equal(saves,3);
  // Own deletion is available; another person's recording remains intact.
  await ownSlot(2).getByRole('button',{name:'Ištrinti'}).click();
  await wait(()=>!recordings.has(own+':2'));
  await wait(()=>ownSlot(2).getByRole('button',{name:'Įrašyti',exact:true}).isEnabled());
  assert(recordings.has(other+':1'));
  // Expired sessions refresh rather than creating a new anonymous user.
  await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('bugnai.auth.'));const value=JSON.parse(localStorage.getItem(key));value.expires_at=1;localStorage.setItem(key,JSON.stringify(value));});
  await page.clock.fastForward(30000);
  await wait(()=>refreshes===1);
  await wait(async()=>await mine.locator('.slot').count()===7);
  assert.equal(signups,1);
  // Playback of another user's sequence and stopping it with a live strike.
  if(!await theirs.evaluate(e=>e.open)) await theirs.locator('summary').click();
  await wait(async()=>await theirs.locator('.slot').count()===7);
  const beforePlayback = await page.evaluate(() => window.audioHits.length);
  await theirs.locator('[data-slot="1"]').getByRole('button',{name:'Atkurti',exact:true}).click();
  await wait(()=>page.locator('#playback-bar').isVisible());
  await page.clock.runFor(80);
  const played = await page.evaluate(before => window.audioHits.slice(before), beforePlayback);
  assert.equal(played.length, 2, 'playback must produce every saved drum hit exactly once');
  assert(played[1] - played[0] >= 40 && played[1] - played[0] <= 80, 'playback preserves the recorded spacing');
  await strike('w');
  assert(await page.locator('#playback-bar').isHidden());
  await page.keyboard.press('x');
  // Own profile image survives reload and can be removed without touching another profile.
  assert.equal(await mine.locator('.avatar img').count(),1);
  await page.locator('#remove-avatar').click();
  await wait(()=>profiles.find(p=>p.id===own).avatar_data===null);
  assert.equal(await page.locator('#my-avatar img').count(),0);
  assert.deepEqual(errors,[]);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(mobile){await fs.mkdir(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/mobile-library.png'),fullPage:true});}
  console.log('PASS',mobile?'mobile touch':'desktop mouse','login, persisted identity/refresh, all 7 slots, read-only others, record/play/overwrite/delete, 2-minute auto-save, retry, empty/discarded attempts, safe names');
  await context.close();
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  await scenario(browser,false);
  await scenario(browser,true);
 }finally{if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
