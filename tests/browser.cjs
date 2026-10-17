const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp3':'audio/mpeg','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}
  catch{res.writeHead(404).end();}
});

const own='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
async function wait(check){
  for(let i=0;i<120;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25));}
  throw new Error('Timed out waiting for expected app state');
}

async function instrumentScenario(browser,file,kit,mobile=false){
  const context=await browser.newContext(mobile?{...devices['Pixel 7']}:{viewport:{width:1280,height:850}});
  const profiles=[{id:other,nickname:'Kitas',created_at:new Date().toISOString()}];
  const recordings=new Map();
  let saves=0,emergencySaves=0,authRequests=0,sessionStarts=0;
  const session=()=>({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,user:{id:own,user_metadata:{nickname:'Ritmas'}}});
  await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:''}));
  await context.route('https://ipwho.is/**',route=>route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({success:true,city:'Vilnius',region:'Vilniaus apskritis',country:'Lietuva'})}));
  await context.route('https://hsqsjxnotqpoodvnxecv.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','content-type':'application/json'};
    const reply=(data,status=200)=>route.fulfill({status,headers,body:JSON.stringify(data)});
    if(method==='OPTIONS')return reply(null);
    if(url.pathname==='/auth/v1/signup'){authRequests++;return reply(session());}
    assert.equal(req.headers().authorization,'Bearer test-access');
    if(url.pathname==='/rest/v1/rpc/start_member_session'){sessionStarts++;return reply(null);}
    if(url.pathname==='/rest/v1/rpc/touch_member_presence')return reply(null);
    if(url.pathname==='/rest/v1/rpc/member_pending_location_request')return reply([]);
    if(url.pathname==='/rest/v1/profiles'){
      if(method==='POST'){profiles.push(req.postDataJSON());return reply(null,201);}
      const id=url.searchParams.get('id')?.slice(3);
      return reply(id?profiles.filter(p=>p.id===id):profiles);
    }
    if(url.pathname==='/rest/v1/performances'){
      const owner=url.searchParams.get('owner_id')?.slice(3);
      if(method==='GET')return reply([...recordings.entries()].filter(([key])=>key.startsWith(owner+':')).map(([,value])=>value));
      if(method==='POST'){
        const item=req.postDataJSON();
        const emergency=url.searchParams.get('on_conflict')==='owner_id,slot';
        if(!emergency&&recordings.has(own+':'+item.slot))return reply({code:'23505'},409);
        const previous=recordings.get(own+':'+item.slot);
        const saved={...previous,...item,created_at:previous?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()};
        recordings.set(own+':'+item.slot,saved);
        if(emergency){emergencySaves++;return route.fulfill({status:204,headers,body:''});}
        saves++;return reply([saved],201);
      }
      if(method==='PATCH'){
        const slot=url.searchParams.get('slot').slice(3),key=own+':'+slot;
        const saved={...recordings.get(key),...req.postDataJSON(),updated_at:new Date().toISOString()};
        recordings.set(key,saved);saves++;return reply([saved]);
      }
      if(method==='DELETE'){recordings.delete(owner+':'+url.searchParams.get('slot').slice(3));return reply(null);}
    }
    throw new Error('Unexpected HTTP request '+method+' '+url.pathname);
  });

  const page=await context.newPage();
  let documentLoads=0;
  page.on('request',req=>{if(req.isNavigationRequest() && req.frame()===page.mainFrame())documentLoads++;});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install();
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base+'/'+file);
  await wait(()=>page.locator('#audio-status').isHidden());
  if(await page.locator('#login').isVisible()){
    await page.locator('#nickname').fill('Ritmas');
    await page.locator('#login-form').evaluate(form=>form.requestSubmit());
  }
  await wait(()=>page.locator(`[data-owner="${own}"]`).count().then(Boolean));
  await wait(()=>page.locator('#rhythm-count').textContent().then(text=>text.includes('0 / 50')));

  assert.equal(await page.locator('#create-rhythm').count(),0);
  assert.equal(await page.locator('#strength-control').count(),0);
  assert(await page.locator('#recording-bar').isHidden());

  if(kit==='salamander-v1'){
    assert.equal(await page.locator('.piano-key').count(),13);
    assert.equal(await page.locator('.black-key').count(),5);
    await page.locator('[data-octave-shift="-1"]').click();
    await page.locator('[data-octave-shift="-1"]').click();
    assert.match(await page.locator('#piano-octave-label').innerText(),/C2–C3/);
    assert.equal(await page.locator('.piano-key').first().getAttribute('data-key'),'c2');
    assert(await page.locator('[data-octave-shift="-1"]').isDisabled());
    for(let i=0;i<4;i++) await page.locator('[data-octave-shift="1"]').click();
    assert.match(await page.locator('#piano-octave-label').innerText(),/C6–C7/);
    assert.equal(await page.locator('.piano-key').last().getAttribute('data-key'),'c7');
    assert(await page.locator('[data-octave-shift="1"]').isDisabled());
    for(let i=0;i<2;i++) await page.locator('[data-octave-shift="-1"]').click();
    assert.match(await page.locator('#piano-octave-label').innerText(),/C4–C5/);
    await page.keyboard.down('a');
    await page.clock.runFor(160);
    await page.locator('[data-octave-shift="-1"]').click();
    await page.keyboard.up('a');
    assert.equal(await page.locator('.piano-key.pressed').count(),0,'changing octave releases a held note');
    await page.locator('[data-octave-shift="1"]').click();
  }

  const strike=async key=>{
    const target=page.locator(`[data-key="${key}"], .${key}.drum`).first();
    if(kit==='salamander-v1'){
      await page.keyboard.down('a');
      await page.clock.runFor(240);
      await page.keyboard.up('a');
    }else if(mobile)await target.tap();
    else await target.click();
  };

  const firstKey=kit==='salamander-v1'?'c4':'w';
  await strike(firstKey);
  assert(await page.locator('#recording-bar').isHidden(),'modal stays hidden while recording');
  if(kit==='salamander-v1'){
    await page.clock.fastForward(3190);
    assert(await page.locator('#recording-bar').isHidden(),'piano waits three seconds after its release tail');
    await page.clock.fastForward(20);
  }else await page.clock.fastForward(12000);
  await wait(()=>page.locator('#recording-bar').isVisible());
  assert.match(await page.locator('#recording-title').textContent(),/Ritmas 1 · Pabaiga/);
  assert.equal(await page.locator('#recording-bar .actions button:visible').count(),3);
  assert.match(await page.locator('#commit-recording').innerText(),/Įrašyti į Ritmas 1/);

  await page.locator('#restart-recording').click();
  assert(await page.locator('#recording-bar').isHidden());
  await strike(firstKey);
  await page.clock.fastForward(12000);
  await wait(()=>page.locator('#recording-bar').isVisible());
  await page.locator('#commit-recording').click();
  await wait(()=>saves===1);
  await wait(()=>page.locator('#recording-bar').isHidden());
  assert.equal(recordings.get(own+':1').kit,kit);

  await strike(firstKey);
  await page.clock.fastForward(12000);
  await wait(()=>page.locator('#recording-bar').isVisible());
  assert.match(await page.locator('#recording-title').textContent(),/Ritmas 2 · Pabaiga/);
  await page.locator('#cancel-recording').click();
  assert(await page.locator('#recording-bar').isHidden());
  assert.equal(saves,1);

  // Tabs keep the document, authentication, library nodes and open member groups alive.
  await page.locator(`[data-owner="${other}"] summary`).click();
  await page.evaluate(()=>{
    window.navigationSentinel='same-app';
    window.liveNotes=0;
    window.addEventListener('drumhit',()=>window.liveNotes++);
    window.libraryNode=document.getElementById('users');
    window.loginFlashes=0;
    new MutationObserver(()=>{if(!document.getElementById('login').hidden)window.loginFlashes++;})
      .observe(document.getElementById('login'),{attributes:true});
  });
  const authBefore=authRequests,sessionsBefore=sessionStarts,loadsBefore=documentLoads;
  const originalFirst=JSON.stringify(recordings.get(own+':1'));
  const alternate=kit==='virtuosity-v1'?'classic-v1':'virtuosity-v1';
  const alternateFile=alternate==='classic-v1'?'index.html':'studio.html';
  const choose=async id=>{
    await page.locator(`[data-kit-link="${id}"]`).click();
    await wait(()=>page.locator('body').getAttribute('data-kit').then(value=>value===id));
    await wait(()=>page.locator('#audio-status').isHidden());
  };
  const playCurrent=async()=>{
    const current=await page.locator('body').getAttribute('data-kit');
    if(current==='salamander-v1'){
      await page.keyboard.down('a');await page.clock.runFor(220);await page.keyboard.up('a');
    }else if(mobile)await page.locator('.drum').first().tap();
    else await page.locator('.drum').first().click();
  };
  // A failed fragment fetch leaves the current instrument usable and does not reload login.
  await context.route(base+'/'+alternateFile,route=>route.abort());
  await playCurrent();
  await page.locator(`[data-kit-link="${alternate}"]`).click();
  await wait(()=>page.locator('#status').innerText().then(text=>text.includes('Instrumento įkelti nepavyko')));
  assert.equal(await page.locator('body').getAttribute('data-kit'),kit);
  await wait(()=>page.locator('#audio-status').isHidden());
  await context.unroute(base+'/'+alternateFile);
  const notesBefore=await page.evaluate(()=>window.liveNotes);
  await playCurrent();
  assert.equal(await page.evaluate(()=>window.liveNotes),notesBefore+1,'recovery must not bind duplicate input listeners');
  // A slow earlier response must not replace the user's newer selection.
  let delayed;
  await context.route(base+'/'+alternateFile,route=>{delayed=route;});
  await page.locator(`[data-kit-link="${alternate}"]`).click();
  await wait(()=>!!delayed);
  await choose(kit);
  await delayed.fulfill({contentType:'text/html',body:await fs.readFile(path.join(root,alternateFile),'utf8')});
  await context.unroute(base+'/'+alternateFile);
  await page.clock.runFor(100);
  assert.equal(await page.locator('body').getAttribute('data-kit'),kit);

  for(const next of [alternate,'salamander-v1','classic-v1','virtuosity-v1',kit]){
    if(await page.locator('body').getAttribute('data-kit')===next)continue;
    await playCurrent();
    await choose(next);
    assert(await page.locator('#recording-bar').isHidden());
    assert.equal(saves,1);
    assert.equal(emergencySaves,0,'switching must never invoke the pagehide emergency save');
    assert.equal(JSON.stringify(recordings.get(own+':1')),originalFirst);
    assert.equal(await page.evaluate(()=>window.navigationSentinel),'same-app');
    assert(await page.evaluate(()=>window.libraryNode===document.getElementById('users')));
    assert(await page.locator(`[data-owner="${other}"]`).evaluate(e=>e.open));
    assert.equal(await page.locator('.kit-tabs [aria-current]').getAttribute('data-kit-link'),next);
    assert.equal(new URL(page.url()).pathname.split('/').at(-1),next==='salamander-v1'?'piano.html':next==='virtuosity-v1'?'studio.html':'index.html');
  }
  await page.clock.fastForward(12000);
  assert(await page.locator('#recording-bar').isHidden(),'old silence timers are cleared');
  // Switching from the review overlay also discards, rather than saving, the draft.
  await playCurrent();
  await page.clock.fastForward(12000);
  await wait(()=>page.locator('#recording-bar').isVisible());
  await choose(alternate);
  assert(await page.locator('#recording-bar').isHidden());
  assert.equal(saves,1);
  await page.goBack();
  await wait(()=>page.locator('body').getAttribute('data-kit').then(value=>value===kit));
  await wait(()=>page.locator('#audio-status').isHidden());
  await page.goForward();
  await wait(()=>page.locator('body').getAttribute('data-kit').then(value=>value===alternate));
  await wait(()=>page.locator('#audio-status').isHidden());
  // A held piano note is released and discarded when changing instruments.
  await choose('salamander-v1');
  await page.keyboard.down('a');
  await page.clock.runFor(200);
  await choose(alternate);
  await page.keyboard.up('a');
  await page.clock.fastForward(12000);
  assert(await page.locator('#recording-bar').isHidden());
  assert.equal(saves,1);
  assert.equal(emergencySaves,0);
  // A recording after navigation uses the new instrument and its note schema.
  await choose('salamander-v1');
  await playCurrent();
  await page.clock.fastForward(12000);
  await wait(()=>page.locator('#recording-bar').isVisible());
  await page.locator('#commit-recording').click();
  await wait(()=>saves===2);
  assert.equal(recordings.get(own+':2').kit,'salamander-v1');
  assert.equal(recordings.get(own+':2').events[0].key,'c4');
  assert(recordings.get(own+':2').events[0].length>=220);
  await choose(kit);
  await page.locator(`[data-owner="${own}"] .slot[data-slot="1"] .play-rhythm`).click();
  await wait(()=>page.locator('#playback-bar').isVisible());
  await choose(alternate);
  assert(await page.locator('#playback-bar').isHidden(),'changing instrument stops playback');
  await choose(kit);
  assert.equal(authRequests,authBefore);
  assert.equal(sessionStarts,sessionsBefore,'tab changes do not start another member session');
  assert.equal(documentLoads,loadsBefore,'no new document navigation');
  assert.equal(await page.evaluate(()=>window.loginFlashes),0);

  if(mobile){
    await page.setViewportSize({width:915,height:412});
    assert.equal(await page.locator('body > header').evaluate(e=>getComputedStyle(e).display),'none');
    const kitBox=await page.locator('.kit').boundingBox();
    assert(kitBox.width>=910&&kitBox.height>=407,'instrument fills a rotated phone');
    const setBox=await page.locator('.set').boundingBox();
    assert(setBox.width>=910&&setBox.height>=407,'keys or drums use the full instrument area');
  }

  await strike(firstKey);
  await page.clock.runFor(250);
  await page.goto(base+'/'+file);
  await wait(()=>page.locator('#audio-status').isHidden());
  if(await page.locator('#login').isVisible()){
    await page.locator('#nickname').fill('Ritmas');
    await page.locator('#login-form').evaluate(form=>form.requestSubmit());
  }
  await wait(()=>emergencySaves>=1);
  assert.equal(recordings.get(own+':1').events[0].key,firstKey,'closing overwrites the emergency first slot');
  assert.deepEqual(errors,[]);
  console.log('PASS',file,mobile?'mobile landscape':'desktop','automatic recording, save/repeat/exit, seamless tabs, draft discard, history, fetch failure/race and emergency slot');
  await context.close();
}

async function adminScenario(browser){
  const context=await browser.newContext();
  const page=await context.newPage();
  await context.route('https://hsqsjxnotqpoodvnxecv.supabase.co/**',route=>{
    const rows=[{id:own,nickname:'Ritmas',created_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),rhythm_count:1,device_type:'Telefonas',os_name:'Android',browser_name:'Chrome',approx_location:'Vilnius, Lietuva'}];
    route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify(rows)});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/admin.html`);
  await page.locator('#admin-code').fill('test-admin-code-123');
  await page.locator('#admin-login-form').evaluate(form=>form.requestSubmit());
  await wait(()=>page.locator('#member-rows tr').count().then(n=>n===1));
  assert.match(await page.locator('#member-rows').textContent(),/Telefonas/);
  console.log('PASS admin member list');
  await context.close();
}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
    for(const [file,kit] of [['index.html','classic-v1'],['studio.html','virtuosity-v1'],['piano.html','salamander-v1']]){
      await instrumentScenario(browser,file,kit,false);
      await instrumentScenario(browser,file,kit,true);
    }
    await adminScenario(browser);
  }finally{if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
