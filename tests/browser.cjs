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
        if(recordings.has(own+':'+item.slot))return reply({code:'23505'},409);
        const saved={...item,updated_at:new Date().toISOString()};recordings.set(own+':'+item.slot,saved);saves++;
        return reply([saved],201);
      }
      const owner=url.searchParams.get('owner_id')?.slice(3);
      if(method==='PATCH'){
        if(failSave)return reply({code:'temporary_error'},503);
        assert.equal(owner,own);
        const key=own+':'+url.searchParams.get('slot').slice(3);
        if(!recordings.has(key))return reply([]);
        const patch=req.postDataJSON();
        const updated={...recordings.get(key),...patch};
        recordings.set(key,updated);
        if(patch.events)saves++;
        return reply([updated]);
      }
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
  const dialogs=[];
  page.on('dialog',dialog=>{dialogs.push(dialog.message());dialog.accept();});
  await page.clock.install();
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  assert(await page.locator('#workspace').isHidden());
  assert.equal(await page.locator('#nickname').evaluate(e=>getComputedStyle(e).userSelect),'text');
  await page.locator('#nickname').fill('Ritmas');
  await page.locator('#login-button').click();
  const mine=page.locator(`[data-owner="${own}"]`);
  const theirs=page.locator(`[data-owner="${other}"]`);
  await wait(()=>mine.getByRole('button',{name:'Sukurti ritmą',exact:true}).isEnabled());
  assert.equal(signups,1);
  assert.equal(await mine.locator('.slot').count(),0);
  await theirs.locator('summary').click();
  await wait(async()=>await theirs.locator('.slot').count()===1);
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
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#upload-avatar').click()]);
  await chooser.setFiles({name:'avatar.png',mimeType:'image/png',buffer:png});
  await wait(()=>!!profiles.find(p=>p.id===own)?.avatar_data);
  await wait(()=>page.locator('#remove-avatar').isEnabled());
  const avatar=profiles.find(p=>p.id===own).avatar_data;
  assert(avatar.startsWith('data:image/jpeg;base64,'));
  assert(avatar.length<=32768);
  assert(await page.locator('#my-avatar img').evaluate(e=>e.naturalWidth===128 && e.naturalHeight===128));
  assert.equal(await mine.locator('.avatar').evaluate(e=>getComputedStyle(e).borderRadius),'50%');
  assert.equal(await page.locator('#upload-avatar').evaluate(e=>getComputedStyle(e).borderRadius),'50%');
  assert.equal(await page.locator('#remove-avatar').evaluate(e=>getComputedStyle(e).fontSize),'11px');
  assert.equal(await page.locator('#remove-avatar').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  assert(await page.locator('#remove-avatar').isHidden());
  await page.locator('#welcome-name').dblclick();
  assert(await page.locator('#remove-avatar').isVisible());
  await page.locator('.kit .hint').click();
  assert(await page.locator('#remove-avatar').isHidden());
  await page.locator('#avatar-file').setInputFiles({name:'invalid.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await wait(async()=>await page.locator('#status').textContent().then(text=>text.includes('JPG, PNG arba WebP')));
  assert.equal(profiles.find(p=>p.id===own).avatar_data,avatar,'invalid uploads must leave the old avatar intact');
  const ownSlot=n=>mine.locator(`.slot[data-slot="${n}"]`);
  const strike=async key=>{if(mobile)await page.locator('.'+key+'.drum').tap();else await page.locator('.'+key+'.drum').click();};
  await mine.getByRole('button',{name:'Sukurti ritmą',exact:true}).click();
  assert.equal(await page.evaluate(()=>scrollY),0,'creating a rhythm moves the page to the top');
  assert.equal(await mine.locator('.slot').count(),0,'unsaved attempts must not create cards');
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
  assert.equal(await mine.locator('.slot').count(),1);
  assert.equal(await theirs.getByRole('button',{name:'Pervadinti',exact:true}).count(),0);
  // Double-click or keyboard activation of the title can rename without a separate button.
  await ownSlot(1).locator('h3').dblclick();
  assert(await page.locator('#rename-dialog').isVisible());
  assert.equal(await page.locator('#rhythm-title-input').evaluate(e=>getComputedStyle(e).userSelect),'text');
  await page.locator('#rhythm-title-input').fill('Mano <img src=x> ritmas');
  await page.locator('#save-title').click();
  await wait(()=>page.locator('#rename-dialog').isHidden());
  assert.equal(recordings.get(own+':1').title,'Mano <img src=x> ritmas');
  assert.equal(await ownSlot(1).locator('h3').textContent(),'Mano <img src=x> ritmas');
  assert.equal(await ownSlot(1).locator('img').count(),0);
  assert.equal(await mine.getByRole('button',{name:'Pervadinti',exact:true}).count(),0);
  await ownSlot(1).locator('h3').focus();
  await page.keyboard.press('Enter');
  await page.locator('#rhythm-title-input').fill('Pirmas ritmas');
  await page.locator('#save-title').click();
  await wait(()=>page.locator('#rename-dialog').isHidden());
  assert.equal(recordings.get(own+':1').title,'Pirmas ritmas');
  const playBox=await ownSlot(1).locator('.play-rhythm').boundingBox();
  const titleBox=await ownSlot(1).locator('h3').boundingBox();
  assert(playBox.x+playBox.width<=titleBox.x,'play control precedes the title');
  assert(Math.abs(playBox.y+playBox.height/2-titleBox.y-titleBox.height/2)<2,'play and title share a row');
  assert((await ownSlot(1).boundingBox()).height <= (mobile?90:60),'rhythm cards stay compact');
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
  await mine.getByRole('button',{name:'Sukurti ritmą',exact:true}).click();
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
  const dialogsBeforeOverwrite=dialogs.length;
  await ownSlot(1).getByRole('button',{name:'Perrašyti'}).click();
  assert.equal(dialogs.length,dialogsBeforeOverwrite,'overwrite starts without a popup');
  assert.equal(await page.evaluate(()=>scrollY),0,'overwrite moves the page to the top');
  await strike('d');
  const beforeReview=await page.evaluate(()=>({height:document.getElementById('recording-bar').getBoundingClientRect().height,kit:document.querySelector('.kit').getBoundingClientRect().top,scroll:scrollY}));
  await page.locator('#finish-recording').click();
  assert.deepEqual(await page.evaluate(()=>({height:document.getElementById('recording-bar').getBoundingClientRect().height,kit:document.querySelector('.kit').getBoundingClientRect().top,scroll:scrollY})),beforeReview,'review controls must not resize the box or move the drums');
  assert(await page.locator('#commit-recording').isVisible());
  assert.equal(JSON.stringify(recordings.get(own+':1')),original,'finishing an overwrite must not save it');
  assert.equal(saves,2);
  const beforePreview=await page.evaluate(()=>window.audioHits.length);
  await page.locator('#preview-recording').click();
  await wait(async()=>await page.locator('#preview-recording').getAttribute('aria-pressed')==='true');
  assert.equal(await page.evaluate(()=>window.audioHits.length),beforePreview+1);
  await page.locator('#restart-recording').click();
  assert(await page.locator('#recording-bar').isVisible());
  assert(await page.locator('#recording-title').textContent().then(text=>text.includes('Laukiama pirmo smūgio')));
  assert.equal(await page.locator('#recording-clock').textContent(),'0.0 s / 120 s');
  assert.equal(JSON.stringify(recordings.get(own+':1')),original,'repeating preserves the old saved rhythm');
  assert.equal(saves,2);
  await strike('a');
  await page.clock.runFor(180);
  await strike('j');
  await page.locator('#finish-recording').click();
  const beforeRepeatPreview=await page.evaluate(()=>window.audioHits.length);
  await page.locator('#preview-recording').click();
  await wait(async()=>await page.locator('#preview-recording').getAttribute('aria-pressed')==='true');
  await page.clock.runFor(1000);
  assert.equal(await page.evaluate(()=>window.audioHits.length),beforeRepeatPreview+2,'repeated take contains only its two new notes');
  await page.locator('#restart-recording').click();
  await page.locator('#finish-recording').click();
  assert(await page.locator('#playback-bar').isHidden());
  assert.equal(JSON.stringify(recordings.get(own+':1')),original,'discarding a preview keeps the original rhythm');
  // The overwrite time limit enters review rather than replacing the old recording.
  await ownSlot(1).getByRole('button',{name:'Perrašyti'}).click();
  await strike('k');
  await page.clock.fastForward(120000);
  assert(await page.locator('#commit-recording').isVisible());
  assert.equal(JSON.stringify(recordings.get(own+':1')),original);
  await page.locator('#restart-recording').click();
  await page.locator('#finish-recording').click();
  failSave=true;
  await ownSlot(1).getByRole('button',{name:'Perrašyti'}).click();
  await strike('j');
  await page.locator('#finish-recording').click();
  assert.equal(JSON.stringify(recordings.get(own+':1')),original);
  await page.locator('#commit-recording').click();
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
  await page.locator('#finish-recording').click();
  await page.reload();
  await wait(async()=>await mine.locator('.slot').count()===2);
  assert(await page.locator('#recording-bar').isHidden());
  assert.equal(signups,1);
  assert.equal(saves,3);
  assert.equal(JSON.stringify(recordings.get(own+':1')),replacement);
  // Empty attempts do not create database records.
  await mine.getByRole('button',{name:'Sukurti ritmą',exact:true}).click();
  await page.locator('#finish-recording').click();
  assert.equal(saves,3);
  // Own deletion is available; another person's recording remains intact.
  await ownSlot(2).getByRole('button',{name:'Ištrinti'}).click();
  await wait(()=>!recordings.has(own+':2'));
  await wait(async()=>await ownSlot(2).count()===0);
  assert.equal(await mine.locator('.slot').count(),1);
  assert(recordings.has(other+':1'));
  // Expired sessions refresh rather than creating a new anonymous user.
  await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('bugnai.auth.'));const value=JSON.parse(localStorage.getItem(key));value.expires_at=1;localStorage.setItem(key,JSON.stringify(value));});
  await page.clock.fastForward(30000);
  await wait(()=>refreshes===1);
  await wait(async()=>await mine.locator('.slot').count()===1);
  assert.equal(signups,1);
  // Playback of another user's sequence and stopping it with a live strike.
  if(!await theirs.evaluate(e=>e.open)) await theirs.locator('summary').click();
  await wait(async()=>await theirs.locator('.slot').count()===2);
  const beforePlayback = await page.evaluate(() => window.audioHits.length);
  await theirs.locator('[data-slot="1"]').getByRole('button',{name:'Atkurti',exact:true}).click();
  await wait(()=>page.locator('#playback-bar').isVisible());
  const firstPlay=theirs.locator('[data-slot="1"] .play-rhythm');
  const secondPlay=theirs.locator('[data-slot="2"] .play-rhythm');
  assert.equal(await firstPlay.getAttribute('aria-pressed'),'true');
  assert.equal(await firstPlay.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(24, 115, 78)');
  assert.equal(await secondPlay.getAttribute('aria-pressed'),'false');
  await page.clock.runFor(80);
  const played = await page.evaluate(before => window.audioHits.slice(before), beforePlayback);
  assert.equal(played.length, 2, 'playback must produce every saved drum hit exactly once');
  assert(played[1] - played[0] >= 40 && played[1] - played[0] <= 80, 'playback preserves the recorded spacing');
  await page.clock.fastForward(10000);
  await wait(()=>page.locator('#playback-bar').isHidden());
  assert.equal(await firstPlay.getAttribute('aria-pressed'),'false','highlight clears at natural playback end');
  await firstPlay.click();
  await wait(async()=>await firstPlay.getAttribute('aria-pressed')==='true');
  await secondPlay.click();
  await wait(async()=>await secondPlay.getAttribute('aria-pressed')==='true');
  assert.equal(await firstPlay.getAttribute('aria-pressed'),'false','switching tracks clears the previous highlight');
  await secondPlay.click();
  assert.equal(await secondPlay.getAttribute('aria-pressed'),'false','clicking the active button stops playback');
  await firstPlay.click();
  await wait(async()=>await firstPlay.getAttribute('aria-pressed')==='true');
  await strike('w');
  assert(await page.locator('#playback-bar').isHidden());
  assert.equal(await firstPlay.getAttribute('aria-pressed'),'false');
  await page.keyboard.press('x');
  // Own profile image survives reload and can be removed without touching another profile.
  assert.equal(await mine.locator('.avatar img').count(),1);
  assert(await page.locator('#remove-avatar').isHidden());
  await page.locator('#welcome-name').dblclick();
  await page.locator('#remove-avatar').click();
  await wait(()=>profiles.find(p=>p.id===own).avatar_data===null);
  assert.equal(await page.locator('#my-avatar img').count(),0);
  assert.deepEqual(errors,[]);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(mobile){await fs.mkdir(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/mobile-library.png'),fullPage:true});}
  // Creating a rhythm must not overwrite a slot taken by another tab mid-recording.
  await mine.getByRole('button',{name:'Sukurti ritmą',exact:true}).click();
  await strike('k');
  recordings.set(own+':2',{slot:2,title:'Kitas langas',events:[{key:'s',time:0}],duration_ms:0,updated_at:new Date().toISOString()});
  await page.locator('#finish-recording').click();
  await wait(()=>page.locator('#retry-recording').isVisible());
  assert.equal(recordings.get(own+':2').title,'Kitas langas');
  assert.equal(recordings.get(own+':2').events[0].key,'s');
  await page.locator('#restart-recording').click();
  await page.locator('#finish-recording').click();
  // Fifty saved cards disable creation; deleting one enables exactly one new rhythm.
  for(let slot=2;slot<=50;slot++)recordings.set(own+':'+slot,{slot,title:'Ritmas '+slot,events:[{key:'w',time:0}],duration_ms:0,updated_at:new Date().toISOString()});
  await page.clock.fastForward(30000);
  await wait(async()=>await mine.locator('.slot').count()===50);
  assert(await mine.getByRole('button',{name:'Sukurti ritmą',exact:true}).isDisabled());
  const list=mine.locator('.rhythm-list');
  assert(await list.evaluate(e=>e.scrollHeight>e.clientHeight));
  assert.equal(await list.evaluate(e=>getComputedStyle(e).scrollbarWidth),'thin');
  await list.evaluate(e=>{e.scrollTop=150;});
  const scroll=await list.evaluate(e=>e.scrollTop);
  recordings.get(own+':1').title='Pavadinimas atnaujintas kitur';
  await page.clock.fastForward(30000);
  await wait(async()=>await ownSlot(1).locator('h3').textContent()==='Pavadinimas atnaujintas kitur');
  assert.equal(await list.evaluate(e=>e.scrollTop),scroll,'polling preserves library scroll position');
  await ownSlot(50).getByRole('button',{name:'Ištrinti',exact:true}).click();
  await wait(()=>mine.getByRole('button',{name:'Sukurti ritmą',exact:true}).isEnabled());
  assert.equal(await mine.locator('.slot').count(),49);
  await mine.getByRole('button',{name:'Sukurti ritmą',exact:true}).click();
  assert.equal(await mine.locator('.slot').count(),49);
  await strike('l');
  await page.locator('#finish-recording').click();
  await wait(async()=>await mine.locator('.slot').count()===50);
  assert.equal(recordings.get(own+':50').events[0].key,'l');
  assert.equal(await ownSlot(51).count(),0);
  // Long names and narrow phones must also keep the recording/review geometry stable.
  await ownSlot(1).locator('h3').focus();
  await page.keyboard.press('Enter');
  await page.locator('#rhythm-title-input').fill('Ilgas ritmo pavadinimas '.repeat(3).slice(0,60).trim());
  await page.locator('#save-title').click();
  await wait(()=>page.locator('#rename-dialog').isHidden());
  for(const width of (mobile?[320,393]:[768,1280])) {
    await page.setViewportSize({width,height:900});
    await ownSlot(1).getByRole('button',{name:'Perrašyti',exact:true}).click();
    await strike('w');
    const geometry=()=>page.evaluate(()=>({height:document.getElementById('recording-bar').getBoundingClientRect().height,kit:document.querySelector('.kit').getBoundingClientRect().top,scroll:scrollY}));
    const before=await geometry();
    await page.locator('#finish-recording').click();
    assert.deepEqual(await geometry(),before,`no layout shift during review at ${width}px`);
    for(const id of ['preview-recording','commit-recording','restart-recording']) {
      assert(await page.locator('#'+id).evaluate(e=>e.scrollHeight<=e.clientHeight),'button labels fit their reserved cells');
      assert.equal(await page.locator('#'+id+' .button-icon').count(),1);
    }
    assert.equal(await page.locator('.action:not(:has(.button-icon))').count(),0,'all action buttons have matching icons');
    await page.locator('#restart-recording').click();
    assert.deepEqual(await geometry(),before,`repeating preserves geometry at ${width}px`);
  await page.locator('#finish-recording').click();
  }
  console.log('PASS',mobile?'mobile touch':'desktop mouse','login/refresh, saved-only cards, create/play/overwrite/delete/rename, read-only others, 2-minute auto-save, retry/discard, avatars and 30-second polling');
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
