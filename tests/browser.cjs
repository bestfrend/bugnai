const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = process.env.SITE_ROOT ? path.resolve(process.env.SITE_ROOT) : path.resolve(__dirname, '..');
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

async function clickInstrument(page,id){
  let choice=page.locator(`[data-kit-link="${id}"], [data-kit-choice="${id}"]`);
  if(!await choice.count()){
    await page.locator('[data-instrument="drums"]').click();
    await wait(()=>page.locator('body').getAttribute('data-kit').then(kit=>kit!=='salamander-v1'));
    await wait(()=>page.locator('#audio-status').isHidden());
    choice=page.locator(`[data-kit-link="${id}"], [data-kit-choice="${id}"]`);
  }
  await choice.click();
}

async function untranslatedPublicText(page){
  return page.evaluate(()=>{
    const remaining=[];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode,element=node.parentElement;
      if(element?.closest('noscript, option[value="lt"], [hidden]'))continue;
      const value=node.textContent.trim();
      if(/[ąčęėįšųūžĄČĘĖĮŠŲŪŽ]/.test(value))remaining.push(value);
    }
    for(const element of document.body.querySelectorAll('[aria-label], [title], [placeholder]')){
      if(element.closest('[hidden]'))continue;
      for(const name of ['aria-label','title','placeholder']){
        const value=element.getAttribute(name);
        if(value&&/[ąčęėįšųūžĄČĘĖĮŠŲŪŽ]/.test(value))remaining.push(`${name}: ${value}`);
      }
    }
    return remaining;
  });
}

async function instrumentScenario(browser,file,kit,mobile=false,forceFallback=false){
  const context=await browser.newContext(mobile?{...devices['Pixel 7']}:{viewport:{width:1280,height:850}});
  if(forceFallback)await context.addInitScript(()=>{window.AudioContext=undefined;window.webkitAudioContext=undefined;});
  const profiles=[{id:other,nickname:'Kitas',created_at:new Date().toISOString()}];
  const recordings=new Map();
  let saves=0,emergencySaves=0,authRequests=0,sessionStarts=0;
  let locationRequest=null;
  let locationDecision=null;
  let locationData=null;
  let beginLocationAvailable=false;
  let locationBeginFailures=0,locationReplyFailures=0,locationRefineFailures=0;
  let locationBeginAttempts=0,locationReplyAttempts=0,locationRefineAttempts=0;
  let loseLocationAcknowledgement=false;
  const attemptedLocationAnswers=[];
  const locationOutcomes=new Map();
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
    if(url.pathname==='/rest/v1/rpc/member_pending_location_request')return reply(locationRequest?[locationRequest]:[]);
    if(url.pathname==='/rest/v1/rpc/member_begin_location_request'){
      locationBeginAttempts++;
      if(locationBeginFailures>0){locationBeginFailures--;return reply({message:'Temporary outage'},503);}
      return beginLocationAvailable?reply(null):reply({code:'PGRST202'},404);
    }
    if(url.pathname==='/rest/v1/rpc/member_refine_location_request'){
      const refinement=req.postDataJSON();
      locationRefineAttempts++;
      if(locationRefineFailures>0){locationRefineFailures--;return reply({message:'Temporary outage'},503);}
      assert.equal(locationOutcomes.get(refinement.p_request_id),'approved','refine only after saving the first fix');
      assert(refinement.p_accuracy_m<locationData.p_accuracy_m,'refinements must improve accuracy');
      locationData=refinement;
      return reply(null);
    }
    if(url.pathname==='/rest/v1/rpc/member_respond_location_request'){
      const decision=req.postDataJSON();
      locationReplyAttempts++;
      attemptedLocationAnswers.push(decision);
      if(locationReplyFailures>0){locationReplyFailures--;return reply({message:'Temporary outage'},503);}
      if(locationOutcomes.has(decision.p_request_id))return reply({code:'P0002'},404);
      locationDecision=decision.p_decision;
      locationData=decision;
      locationOutcomes.set(decision.p_request_id,decision.p_decision);
      if(locationRequest?.id===decision.p_request_id)locationRequest=null;
      if(loseLocationAcknowledgement){loseLocationAcknowledgement=false;return reply({message:'Response interrupted'},503);}
      return reply(null);
    }
    if(url.pathname==='/rest/v1/profiles'){
      if(method==='PATCH'){
        const profile=profiles.find(profile=>profile.id===own);
        Object.assign(profile,req.postDataJSON());
        return reply([profile]);
      }
      if(method==='POST'){
        const profile=req.postDataJSON();
        if(profiles.some(existing=>existing.nickname.toLowerCase()===profile.nickname.trim().toLowerCase()))return reply({code:'23505',message:'Nickname is already taken'},409);
        profiles.push(profile);return reply(null,201);
      }
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
  await page.goto(base+(file==='index.html'?'/':'/'+file));
  await wait(()=>page.locator('#audio-status').isHidden());
  assert.equal(await page.locator('html').getAttribute('translate'),'no','browser translation must not override the language selector');
  assert.equal(await page.locator('meta[name="google"]').getAttribute('content'),'notranslate');
  assert.equal(await page.locator('html').getAttribute('lang'),'lt','Lithuanian is the initial language');
  assert.equal(await page.locator('#language-select').inputValue(),'lt');
  assert(await page.locator('#status').isHidden(),'no connection message before entering a name');
  assert(await page.locator('.kit-tabs').isHidden(),'instrument tabs wait until sign-in');
  assert.equal(await page.locator('#play-help-dialog').evaluate(dialog=>dialog.open),false,'playing instructions never open automatically');
  await page.locator('.play-help-menu summary').click();
  await page.locator('#open-play-help').click();
  assert(await page.locator('#play-help-dialog').evaluate(dialog=>dialog.open),'the header dropdown opens playing instructions');
  assert.match(await page.locator('#play-help-dialog').innerText(),/Dalinę ekrano kopiją laikant tris pirštus/);
  assert.match(await page.locator('#play-help-dialog').innerText(),/braukiant trimis pirštais žemyn/);
  assert.doesNotMatch(await page.locator('#play-help-dialog').innerText(),/POCO|Xiaomi|telefono/,'playing help applies to any touch device');
  await page.locator('#close-play-help').click();
  assert.equal(await page.locator('#play-help-dialog').evaluate(dialog=>dialog.open),false,'playing instructions can be dismissed');
  await page.locator('#login-button').click();
  assert(await page.locator('#status').isHidden(),'empty name does not start connecting');
  assert.equal(sessionStarts,0,'empty name does not start a session');
  if(file==='index.html')assert.equal(await page.locator('body').getAttribute('data-kit'),'salamander-v1','home page opens piano');
  await page.locator('#language-select').selectOption('sv');
  await page.locator('.play-help-menu summary').click();
  await page.locator('#open-play-help').click();
  assert.equal(await page.locator('#play-help-title').textContent(),'Innan du spelar');
  assert.match(await page.locator('#play-help-dialog').innerText(),/hålla ned tre fingrar/);
  assert.match(await page.locator('#play-help-dialog').innerText(),/svepa nedåt med tre fingrar/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#play-help-dialog').evaluate(dialog=>dialog.open),false,'Escape dismisses the help dialog');
  assert.equal(await page.locator('html').getAttribute('lang'),'sv');
  assert.equal(await page.locator('label[for="language-select"]').count(),0);
  assert.equal(await page.locator('#language-select').getAttribute('aria-label'),'Language');
  assert.deepEqual(await page.locator('#language-select option').allTextContents(),['🇱🇹 Lietuvių','🇸🇪 Svenska']);
  assert.equal(await page.locator('#login-title').innerText(),'Ange ditt namn');
  assert.equal(await page.locator('#nickname').getAttribute('placeholder'),'Ange ditt namn');
  assert((await page.locator('#login-form label').boundingBox()).width<=1,'name label is visually hidden');
  assert.equal(await page.getByRole('textbox',{name:'Namn'}).count(),1,'name field remains accessible');
  assert.equal(await page.locator('#login p').count(),0,'login shows only the name form');
  await page.locator('#nickname').fill('   ');
  await page.locator('#login-form').evaluate(form=>form.requestSubmit());
  assert.match(await page.locator('#status').innerText(),/Ange ett namn/);
  assert.equal(sessionStarts,0,'whitespace name does not start a session');
  assert.equal(await page.locator('.kit-tabs a').count(),2,'only piano and drums are top-level tabs');
  assert.equal(await page.locator('[data-instrument="drums"]').textContent(),'Trummor');
  if(kit==='classic-v1'){
    assert.equal(await page.locator('.drum').first().getAttribute('aria-label'),'Tom 1, W');
  }else if(kit==='virtuosity-v1'){
    assert.equal(await page.locator('.drum-name').first().innerText(),'Hög tom-tom');
  }else if(kit==='stage-v1'){
    assert.equal(await page.locator('#title').innerText(),'Trummor');
    assert.equal(await page.locator('.stage-kit .drum.s').count(),1,'visual kit keeps a distinct hi-hat pad');
  }
  assert.deepEqual(await untranslatedPublicText(page),[],'login screen is fully translated');
  await page.reload();
  await wait(()=>page.locator('#audio-status').isHidden());
  assert.equal(await page.locator('#language-select').inputValue(),'sv','language survives reload');
  await page.locator('#language-select').selectOption('lt');
  if(await page.locator('#login').isVisible()){
    await page.locator('#nickname').fill('kITAS');
    await page.locator('#login-form').evaluate(form=>form.requestSubmit());
    await wait(()=>page.locator('#status').innerText().then(text=>text==='Šis vardas jau užimtas. Pasirink kitą vardą.'));
    assert(await page.locator('#login').isVisible(),'a taken nickname cannot enter the app');
    assert.equal(sessionStarts,0,'rejected registration does not start a member session');
    await page.locator('#language-select').selectOption('sv');
    assert.equal(await page.locator('#status').innerText(),'Namnet är redan upptaget. Välj ett annat namn.');
    await page.locator('#language-select').selectOption('lt');
    await page.locator('#nickname').fill('Ritmas');
    await page.locator('#login-form').evaluate(form=>form.requestSubmit());
  }
  await wait(()=>page.locator(`[data-owner="${own}"]`).count().then(Boolean));
  assert(await page.locator('.kit-tabs').isVisible(),'instrument tabs appear after sign-in');
  await wait(()=>page.locator('#rhythm-count').textContent().then(text=>text.includes('0 / 50')));
  const statusBeforeLocation=await page.locator('#status').textContent();
  locationRequest={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expires_at:null};
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  locationRequest=null;
  await page.clock.runFor(600);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open));
  assert.equal(await page.locator('#status').textContent(),statusBeforeLocation,'admin can silently close an unanswered modal');

  await page.evaluate(()=>{
    window.locationPermission = Object.assign(new EventTarget(), {state:'prompt'});
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = descriptor => descriptor.name === 'geolocation'
      ? Promise.resolve(window.locationPermission) : query(descriptor);
  });
  await page.evaluate(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
    getCurrentPosition(success,error){window.positionRequests=(window.positionRequests||0)+1;window.resolveLocation=success;window.rejectLocation=error;}
  }}));
  locationRequest={id:'55555555-5555-4555-8555-555555555555',expires_at:null};
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.evaluate(()=>{
    navigator.locks.request('bugnai.auth.hsqsjxnotqpoodvnxecv',()=>{
      window.locationAuthLockHeld=true;
      return new Promise(resolve=>{window.releaseLocationAuthLock=resolve;});
    });
  });
  await wait(()=>page.evaluate(()=>window.locationAuthLockHeld===true));
  const firstLocationChoice=page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'});
  const choiceBox=await firstLocationChoice.boundingBox();
  await page.mouse.move(choiceBox.x+choiceBox.width/2,choiceBox.y+choiceBox.height/2);
  await page.mouse.down();
  await page.clock.runFor(150);
  assert.equal(await firstLocationChoice.evaluate(button=>getComputedStyle(button).backgroundColor),'rgb(214, 56, 133)','location choice shows pressed background');
  await page.mouse.up();
  assert(await page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open),'share closes immediately before location is available');
  await wait(()=>page.evaluate(()=>window.positionRequests===1));
  await page.clock.fastForward(12000);
  assert(await page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open),'waiting for browser permission does not reopen the modal');
  await page.evaluate(()=>window.resolveLocation({coords:{latitude:54.68,longitude:25.28,accuracy:10}}));
  await wait(()=>locationDecision==='approved');
  await page.evaluate(()=>window.releaseLocationAuthLock());
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open));
  beginLocationAvailable=true;
  assert.equal(await page.locator('#status').textContent(),statusBeforeLocation,'successful sharing leaves the app status unchanged');
  locationRequest={id:'33333333-3333-4333-8333-333333333333',expires_at:null};
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'}).click();
  await wait(()=>page.evaluate(()=>window.positionRequests===2));
  assert(await page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open));
  await page.evaluate(()=>{window.previousLocationResult=window.resolveLocation;});
  locationRequest=null;
  await page.clock.runFor(600);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open));
  assert.equal(await page.locator('#status').textContent(),statusBeforeLocation,'admin cancellation closes the request without a message');
  locationDecision=null;
  locationRequest={id:'99999999-9999-4999-8999-999999999999',expires_at:null};
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  const nextShare=page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'});
  assert(await nextShare.isEnabled(),'a new request stays usable while an earlier browser result is pending');
  await nextShare.click();
  assert(await page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open));
  await wait(()=>page.evaluate(()=>window.positionRequests===3));
  await page.evaluate(()=>window.previousLocationResult({coords:{latitude:56,longitude:24,accuracy:5}}));
  await wait(()=>locationDecision==='approved');
  assert.equal(await page.locator('#status').textContent(),statusBeforeLocation,'late browser approval is saved silently after admin cancellation');
  await page.evaluate(()=>window.rejectLocation({code:1,message:'User denied Geolocation'}));
  await wait(()=>locationDecision==='browser_denied');
  locationRequest={id:'66666666-6666-4666-8666-666666666666',expires_at:null};
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Atmesti',exact:true}).click();
  await wait(()=>locationDecision==='declined');
  assert(await page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open));
  assert.equal(await page.locator('#status').textContent(),statusBeforeLocation,'in-app refusal leaves the app status unchanged');
  locationDecision=null;
  await page.evaluate(()=>window.resolveLocation({coords:{latitude:56,longitude:24,accuracy:5}}));
  await page.clock.runFor(100);
  assert.equal(locationDecision,null,'in-app refusal also invalidates a pending browser approval');
  await page.evaluate(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
    getCurrentPosition(success,error){error({code:1,message:'User denied Geolocation'});}
  }}));
  locationRequest={id:'44444444-4444-4444-8444-444444444444',expires_at:new Date(await page.evaluate(()=>Date.now())+10000).toISOString()};
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'}).click();
  await wait(()=>locationDecision==='browser_denied');
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open));
  assert.equal(await page.locator('#status').textContent(),statusBeforeLocation,'browser refusal leaves the app status unchanged');

  await page.evaluate(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
    watchPosition(success,error,options){window.watchOptions=options;window.watchSuccess=success;window.watchError=error;window.watchCount=(window.watchCount||0)+1;return window.watchCount;},
    clearWatch(id){window.clearedLocationWatch=id;}
  }}));
  locationDecision=null;
  locationRequest={id:'77777777-7777-4777-8777-777777777777',expires_at:null};
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'}).click();
  await wait(()=>page.evaluate(()=>window.watchCount===1));
  assert.deepEqual(await page.evaluate(()=>window.watchOptions),{enableHighAccuracy:true,maximumAge:0,timeout:30000});
  await page.clock.fastForward(20000);
  assert(await page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open),'permission waiting remains in the background');
  await page.evaluate(()=>window.watchSuccess({coords:{latitude:54,longitude:25,accuracy:2500}}));
  await wait(()=>locationDecision==='approved');
  assert.equal(locationData.p_accuracy_m,2500,'first fix is saved without waiting for the refinement timer');
  await page.clock.runFor(100);
  await page.evaluate(()=>window.watchSuccess({coords:{latitude:54.68,longitude:25.28,accuracy:8}}));
  await wait(()=>locationDecision==='approved');
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open));
  await wait(()=>locationData.p_accuracy_m===8);
  assert.equal(locationData.p_latitude,54.68);
  assert.equal(await page.evaluate(()=>window.clearedLocationWatch),1,'watch stops after an accurate fix');

  locationDecision=null;
  locationRequest={id:'88888888-8888-4888-8888-888888888888',expires_at:null};
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'}).click();
  await wait(()=>page.evaluate(()=>window.watchCount===2));
  await page.evaluate(()=>{
    window.watchSuccess({coords:{latitude:54,longitude:25,accuracy:2500}});
    window.watchSuccess({coords:{latitude:54.1,longitude:25.1,accuracy:800}});
    window.watchSuccess({coords:{latitude:54.2,longitude:25.2,accuracy:2000}});
  });
  await page.clock.fastForward(12000);
  await wait(()=>locationDecision==='approved');
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open));
  await wait(()=>locationData.p_accuracy_m===800);
  assert.equal(locationData.p_accuracy_m,800,'save improvements without overwriting them with a worse fix');
  assert.equal(await page.evaluate(()=>window.clearedLocationWatch),2,'coarse-only acquisition is bounded');
  assert.equal(await page.locator('#status').textContent(),statusBeforeLocation,'refinement adds no client messages');

  locationRequest={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',expires_at:null};
  locationDecision=null;
  locationBeginFailures=1;
  const beforeBegin=locationBeginAttempts;
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'}).click();
  await wait(()=>locationDecision==='declined');
  assert.equal(await page.evaluate(()=>window.watchCount),3,'only one browser request is opened');
  await page.clock.runFor(12000);
  assert.equal(locationBeginAttempts,beforeBegin+1,'a failed request marker is never retried');

  locationRequest={id:'ffffffff-ffff-4fff-8fff-ffffffffffff',expires_at:null};
  locationDecision=null;
  locationReplyFailures=1;
  const beforeRefine=locationRefineAttempts;
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'}).click();
  await page.evaluate(()=>window.watchSuccess({coords:{latitude:54,longitude:25,accuracy:2500}}));
  await wait(()=>locationDecision==='declined');
  await page.evaluate(()=>window.watchSuccess({coords:{latitude:54.68,longitude:25.28,accuracy:8}}));
  await page.clock.runFor(12000);
  assert.deepEqual(attemptedLocationAnswers.filter(answer=>answer.p_request_id==='ffffffff-ffff-4fff-8fff-ffffffffffff').map(answer=>answer.p_decision),['approved','declined'],'an interrupted approval is not resent; a single refusal closes the request');
  assert.equal(locationRefineAttempts,beforeRefine,'refinements stop after a failed approval');

  locationRequest={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expires_at:null};
  locationReplyFailures=1;
  const beforeRefusal=locationReplyAttempts;
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Atmesti',exact:true}).click();
  await wait(()=>locationReplyAttempts===beforeRefusal+1);
  await page.clock.runFor(12000);
  assert.equal(locationReplyAttempts,beforeRefusal+1,'a failed refusal is not automatically resent');
  assert(await page.locator('#location-request-dialog').evaluate(dialog=>!dialog.open),'the same pending request is never shown again');
  locationRequest=null;

  locationRequest={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',expires_at:null};
  locationDecision=null;
  const beforeOffline=locationReplyAttempts;
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'}).click();
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
    window.dispatchEvent(new Event('offline'));
    window.watchSuccess({coords:{latitude:54.68,longitude:25.28,accuracy:8}});
  });
  await page.clock.runFor(12000);
  assert.equal(locationReplyAttempts,beforeOffline,'no network write is attempted while the browser is offline');
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
    window.dispatchEvent(new Event('online'));
  });
  await wait(()=>locationDecision==='declined');
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.clock.runFor(12000);
  assert.equal(locationReplyAttempts,beforeOffline+1,'reconnection sends only one terminal refusal, never an approval or a new prompt');

  locationRequest={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expires_at:null};
  loseLocationAcknowledgement=true;
  const beforeLostAck=locationReplyAttempts;
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'}).click();
  await page.evaluate(()=>window.watchSuccess({coords:{latitude:54.68,longitude:25.28,accuracy:8}}));
  await wait(()=>loseLocationAcknowledgement===false);
  await wait(()=>locationReplyAttempts===beforeLostAck+2);
  await page.clock.runFor(12000);
  assert.equal(locationReplyAttempts,beforeLostAck+2,'even a lost acknowledgement does not cause the approval to be repeated');
  assert.equal(await page.locator('#status').textContent(),statusBeforeLocation,'connection failures add no client messages');

  locationRequest={id:'12121212-1212-4212-8212-121212121212',expires_at:null};
  locationDecision=null;
  await page.clock.runFor(2100);
  await wait(()=>page.locator('#location-request-dialog').evaluate(dialog=>dialog.open));
  await page.locator('#location-request-dialog').getByRole('button',{name:'Bendrinti dabartinę vietą'}).click();
  await page.clock.fastForward(65000);
  assert.equal(locationDecision,null,'waiting for a permission choice has no application deadline');
  await page.evaluate(()=>{
    window.locationPermission.state='granted';
    window.locationPermission.dispatchEvent(new Event('change'));
  });
  await page.clock.runFor(30100);
  await wait(()=>locationDecision==='error');
  assert.equal(await page.locator('#status').textContent(),statusBeforeLocation,'a stalled browser acquisition ends silently after permission');

  assert.equal(await page.locator('#create-rhythm').count(),0);
  assert.equal(await page.locator('#strength-control').count(),0);
  assert(await page.locator('#recording-bar').isHidden());
  assert.equal(await page.locator('.lesson-card').count(),4,'each instrument shows its own lessons');
  assert.equal(await page.locator('.lesson-speed').count(),12,'lessons offer three speeds');
  assert.deepEqual(await page.locator('.lesson-card').first().locator('.lesson-speed').allTextContents(),['Lėtas','Normalus','Greitas']);
  const startSelectedLesson=async()=>{
    await page.locator('#lesson-start').getByRole('button',{name:'Pradėti pamoką'}).click();
    assert.equal(await page.locator('.lesson-cue').count(),0,'starting a lesson leaves preparation time before the first cue');
    assert.equal(await page.locator('#lesson-sequence .is-due').count(),0,'the central note is not emphasized before it is due');
    await page.clock.fastForward(700);
    assert.equal(await page.locator('.lesson-cue').count(),0,'the first cue waits a full second');
    await page.clock.fastForward(300);
    await page.clock.runFor(20);
    assert(await page.locator('.lesson-cue').count(),'the first cue appears after preparation');
    assert.equal(await page.locator('#lesson-sequence .is-current.is-due').count(),1,'the central note is emphasized when it is time to press');
  };
  if(kit==='salamander-v1'){
    assert.deepEqual(await page.locator('#lesson-levels [role="tab"]').allTextContents(),['I lygis','II lygis','III lygis']);
    await page.locator('#lesson-level-2').click();
    assert.equal(await page.locator('.lesson-card').count(),1,'levels may have different song counts');
    assert.equal(await page.locator('.lesson-card h3').textContent(),'Menuetas');
    assert.equal(await page.locator('.lesson-composer').textContent(),'Christian Petzold');
    await page.locator('.lesson-speed').nth(1).click();
    await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
    assert.equal(await page.locator('.piano-keyboard.lesson-range').count(),1,'an advanced range is fitted to the lesson automatically');
    assert.equal(await page.locator('[data-key="g5"]').count(),1);
    assert.equal(await page.locator('[data-key="fs4"]').count(),1);
    await page.locator('#language-select').selectOption('sv');
    assert.equal(await page.locator('#lesson-level-2').textContent(),'Nivå II');
    assert.equal(await page.locator('.lesson-card h3').textContent(),'Menuett');
    assert.equal(await page.locator('[data-key="g5"]').count(),1,'translating does not reset the lesson range');
    assert.equal(await page.locator('#lesson-start').count(),1);
    await page.locator('#language-select').selectOption('lt');
    await page.locator('#listen-lesson').click();
    await wait(()=>page.locator('#listen-lesson').getAttribute('aria-pressed').then(value=>value==='true'));
    await page.locator('#lesson-level-3').click();
    assert.equal(await page.locator('#lesson-start').count(),0,'changing levels cancels the previous lesson and preview');
    assert.equal(await page.locator('.piano-keyboard.lesson-range').count(),0,'switching levels restores the previous keyboard view');
    assert.equal(await page.locator('.lesson-card').getAttribute('data-lesson-id'),'fur-elise-theme');
    await page.locator('.lesson-speed').nth(1).click();
    await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
    assert.equal(await page.locator('[data-key="e5"]').count(),1);
    assert.equal(await page.locator('[data-key="ds5"]').count(),1,'the theme exposes its high black keys');
    const fits=await page.locator('.piano-keyboard').evaluate(keyboard=>{
      const box=keyboard.getBoundingClientRect();
      return [...keyboard.querySelectorAll('[data-key]')].every(key=>{const b=key.getBoundingClientRect();return b.x>=box.x&&b.right<=box.right+1;});
    });
    assert(fits,'the lesson keyboard stays inside the screen');
    await page.clock.pauseAt(await page.evaluate(()=>Date.now()+50));
    await page.locator('#lesson-start').getByRole('button',{name:'Pradėti pamoką'}).click();
    await page.clock.fastForward(1000);
    await page.clock.runFor(20);
    assert.equal(await page.locator('[data-key="e5"].lesson-cue').count(),1,'Für Elise starts with the expected high E');
    await page.keyboard.down(';');
    assert.equal(await page.locator('[data-key="e5"].lesson-correct').count(),1,'the expanded keyboard maps its extra notes to physical keys too');
    await page.keyboard.up(';');
    await page.clock.fastForward(220);
    await page.clock.runFor(20);
    assert.equal(await page.locator('[data-key="ds5"].lesson-cue').count(),1,'sixteenth-note guidance uses the song tempo');
    await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
    assert.equal(await page.locator('.piano-keyboard [data-key]').count(),13,'stopping restores the ordinary one-octave keyboard');
    await page.clock.resume();
    await page.locator('#lesson-level-1').click();
    await page.evaluate(async()=>{
      const entry=new URL(document.querySelector('script[src*="app.js"]').src);
      const {lessonsForKit}=await import(new URL('./lessons.js'+entry.search,entry).href);
      const library=lessonsForKit('salamander-v1');
      library.push({...library[0],id:'scroll-test-1'},{...library[0],id:'scroll-test-2'});
      window.dispatchEvent(new Event('languagechange'));
    });
    await wait(()=>page.locator('#lesson-list').evaluate(list=>list.scrollHeight>list.clientHeight));
    assert.equal(await page.locator('.lesson-card').count(),6);
    const fiveRows=await page.locator('#lesson-list').evaluate(list=>{
      const box=list.getBoundingClientRect(),fifth=list.children[4].getBoundingClientRect(),sixth=list.children[5].getBoundingClientRect();
      return fifth.bottom<=box.bottom+1&&sixth.top>=box.bottom;
    });
    assert(fiveRows,'only the first five full song cards fit before the list scrolls');
    await page.locator('#lesson-list').evaluate(list=>list.scrollTop=list.scrollHeight);
    assert(await page.locator('#lesson-list').evaluate(list=>list.scrollTop>0),'more songs can be reached by scrolling the list');
    await page.locator('#lesson-level-1').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#lesson-level-2').getAttribute('aria-selected'),'true','level tabs support arrow keys');
    assert.equal(await page.locator('#lesson-list').evaluate(list=>list.style.maxHeight),'','shorter levels remove the scroll cap');
    await page.evaluate(async()=>{
      const entry=new URL(document.querySelector('script[src*="app.js"]').src);
      const {lessonsForKit}=await import(new URL('./lessons.js'+entry.search,entry).href);
      lessonsForKit('salamander-v1').splice(-2,2);
    });
    await page.locator('#lesson-level-1').click();
    assert.equal(await page.locator('.lesson-card').count(),4);
  } else assert(await page.locator('#lesson-levels').isHidden(),'piano level tabs stay hidden for drums');
  // A valid image larger than the former limit must reach the existing resize
  // path. Extra PNG bytes do not allocate a huge decoded bitmap in this test.
  const largePhoto=Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),Buffer.alloc(6*1024*1024)]);
  await page.locator('#avatar-file').setInputFiles({name:'large-photo.png',mimeType:'image/png',buffer:largePhoto});
  await wait(()=>Promise.resolve(profiles.find(profile=>profile.id===own)?.avatar_data));
  const avatar=profiles.find(profile=>profile.id===own).avatar_data;
  assert(avatar.startsWith('data:image/jpeg;base64,'),'large uploads are converted to JPEG');
  assert(avatar.length<=32768,'only the small optimized avatar is sent to the database');
  const avatarSize=await page.evaluate(async data=>{const image=new Image();image.src=data;await image.decode();return [image.naturalWidth,image.naturalHeight];},avatar);
  assert.deepEqual(avatarSize,[128,128],'the original file is resized to the profile dimensions');
  await wait(()=>page.locator('#my-avatar img').count().then(count=>count===1));
  assert.equal(await page.locator('#show-lesson-sequence').isChecked(),false,'the note sequence is opt-in on a fresh browser');
  assert(await page.locator('#show-lesson-repeat-counts').isChecked(),'key repetition counts are enabled on a fresh browser');
  await page.locator('.lesson-speed').first().click();
  await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
  await page.locator('#lesson-start').getByRole('button',{name:'Pradėti pamoką'}).click();
  await page.clock.fastForward(1100);
  await page.clock.runFor(20);
  assert(await page.locator('#lesson-sequence').isHidden(),'lessons hide the sequence until the user enables it');
  assert(await page.locator('.lesson-cue').count(),'keyboard cues continue when the note sequence is hidden');
  if(kit==='salamander-v1'){
    const count=page.locator('[data-key="e4"] .lesson-repeat-count');
    assert.equal(await count.textContent(),'2','a repeated piano cue shows two presses even while the sequence is hidden');
    assert(await count.isVisible(),'the count is visible with the cue');
    const placement=await count.evaluate(label=>{const style=getComputedStyle(label);const key=label.parentElement.getBoundingClientRect(),box=label.getBoundingClientRect();return {color:style.color,centered:Math.abs((box.x+box.width/2)-(key.x+key.width/2))<2&&Math.abs((box.y+box.height/2)-(key.y+key.height/2))<2};});
    assert.equal(placement.color,'rgb(36, 48, 68)','white keys have dark numbers');
    assert(placement.centered,'the number is centered on the key');
  }
  await page.locator('.play-help-menu summary').click();
  await page.locator('#show-lesson-repeat-counts').uncheck();
  assert.equal(await page.locator('.lesson-repeat-count').count(),0,'repetition counts can be hidden independently of the sequence');
  await page.locator('#show-lesson-repeat-counts').check();
  if(kit==='salamander-v1')assert.equal(await page.locator('[data-key="e4"] .lesson-repeat-count').textContent(),'2','turning the setting back on restores the remaining count');
  await page.locator('#language-select').selectOption('sv');
  assert.equal(await page.locator('#lesson-repeat-counts-setting-label').textContent(),'Visa antalet upprepningar på tangenterna','the repetition setting is translated into Swedish');
  await page.locator('#language-select').selectOption('lt');
  await page.locator('#show-lesson-sequence').check();
  assert(await page.locator('#lesson-sequence').isVisible(),'the menu can show the sequence during practice');
  assert.equal(await page.evaluate(()=>localStorage.getItem('bugnai.lesson-sequence')),'true','the preference is saved');
  await page.locator('#show-lesson-sequence').uncheck();
  assert(await page.locator('#lesson-sequence').isHidden(),'the menu can hide the sequence immediately');
  await page.locator('#show-lesson-sequence').check();
  await page.locator('.play-help-menu summary').click();
  await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
  await page.evaluate(()=>{
    window.lessonDemoSounds=[];
    window.lessonDemoLiveHits=0;
    window.lessonDemoReleases=[];
    window.addEventListener('drumhit',()=>window.lessonDemoLiveHits++);
    if(window.AudioContext){
      const create=AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource=function(...args){
        const source=create.apply(this,args),start=source.start.bind(source),stop=source.stop.bind(source);
        let started;
        source.start=(...args)=>{started=performance.now();window.lessonDemoSounds.push(started);return start(...args);};
        source.stop=(...args)=>{if(args.length&&started!==undefined)window.lessonDemoReleases.push({started,at:performance.now()});return stop(...args);};
        return source;
      };
    }else{
      const play=HTMLMediaElement.prototype.play,pause=HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.play=function(...args){this.lessonDemoStarted=performance.now();window.lessonDemoSounds.push(this.lessonDemoStarted);return play.apply(this,args);};
      HTMLMediaElement.prototype.pause=function(...args){if(this.lessonDemoStarted!==undefined){window.lessonDemoReleases.push({started:this.lessonDemoStarted,at:performance.now()});delete this.lessonDemoStarted;}return pause.apply(this,args);};
    }
  });
  for(const [label,beatMs] of [['Lėtas',1400],['Normalus',520],['Greitas',350]]){
    await page.locator('.lesson-card').first().getByRole('button',{name:label,exact:true}).click();
    await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
    assert.equal(await page.locator('#lesson-selected-tempo').textContent(),label,'the selected tempo is visible beside the preview and start controls');
    assert.equal(await page.locator('.lesson-speed.is-selected').textContent(),label,'the chosen tempo remains highlighted in its lesson card');
    assert.equal(await page.locator('.lesson-speed.is-selected').getAttribute('aria-pressed'),'true');
    const before=await page.evaluate(()=>window.lessonDemoSounds.length);
    await page.locator('#listen-lesson').click();
    await wait(()=>page.evaluate(count=>window.lessonDemoSounds.length>count,before));
    assert.equal(await page.locator('#listen-lesson').getAttribute('aria-pressed'),'true','listening has an active stop control');
    const interval=kit==='salamander-v1'?beatMs:beatMs*.5;
    const elapsed=await page.evaluate(index=>performance.now()-window.lessonDemoSounds[index],before);
    await page.clock.fastForward(Math.max(0,interval-elapsed-40));
    assert.equal(await page.evaluate(()=>window.lessonDemoSounds.length),before+1,'a preview waits for the selected tempo before its second note');
    await page.clock.fastForward(80);
    assert.equal(await page.evaluate(()=>window.lessonDemoSounds.length),before+2,'the next preview note sounds at the selected tempo');
    assert.equal(await page.evaluate(()=>window.lessonDemoLiveHits),0,'demo notes are not recorded as user input');
    if(label==='Lėtas'){
      await page.locator('#language-select').selectOption('sv');
      assert.equal(await page.locator('#lesson-selected-tempo').textContent(),'Långsam','the selected tempo translates into Swedish');
      assert.equal(await page.locator('#listen-lesson').innerText(),'Stoppa provlyssningen','active listening controls translate into Swedish');
      await page.locator('#language-select').selectOption('lt');
    }
    await page.clock.fastForward(120000);
    await page.clock.runFor(25);
    await wait(()=>page.locator('#listen-lesson').getAttribute('aria-pressed').then(value=>value==='false'));
    assert(await page.locator('#recording-bar').isHidden(),'listening to a complete piece never opens recording review');
    await page.locator('#listen-lesson').click();
    await wait(()=>page.locator('#listen-lesson').getAttribute('aria-pressed').then(value=>value==='true'));
    await page.locator('#listen-lesson').click();
    const stoppedCount=await page.evaluate(()=>window.lessonDemoSounds.length);
    await page.clock.fastForward(beatMs*2);
    assert.equal(await page.evaluate(()=>window.lessonDemoSounds.length),stoppedCount,'stopping a preview cancels its remaining notes');
    await page.locator('#listen-lesson').click();
    await wait(()=>page.evaluate(count=>window.lessonDemoSounds.length>count,stoppedCount));
    await startSelectedLesson();
    const startedCount=await page.evaluate(()=>window.lessonDemoSounds.length);
    await page.clock.fastForward((kit==='salamander-v1'?2:1)*beatMs+25);
    assert.equal(await page.evaluate(()=>window.lessonDemoSounds.length),startedCount,'starting a lesson stops the demo audio');
    const expected=kit==='salamander-v1'?'f4':'j';
    assert(await page.locator(`.kit .set [data-key="${expected}"]`).evaluate(element=>element.classList.contains('lesson-cue')),`${label} shows notes at the new tempo`);
    if(kit==='salamander-v1' && label==='Lėtas'){
      const cueStyle=await page.locator('.lesson-cue').first().evaluate(element=>({outline:getComputedStyle(element).outlineStyle,shadow:getComputedStyle(element).boxShadow,transform:getComputedStyle(element).transform}));
      assert.equal(cueStyle.outline,'none','lesson cues have no top or bottom outline');
      assert.equal(cueStyle.shadow,'none','a non-repeated cue has no shadow');
      assert.equal(cueStyle.transform,'none','non-repeated notes keep their existing cue');
      const cueEdges=await page.locator('.lesson-cue').first().evaluate(key=>{
        const edge=getComputedStyle(key,'::after');
        return {left:edge.borderLeftWidth,right:edge.borderRightWidth,top:edge.borderTopWidth,bottom:edge.borderBottomWidth,color:edge.borderLeftColor,shadow:edge.boxShadow};
      });
      assert.deepEqual(cueEdges,{left:'2px',right:'2px',top:'0px',bottom:'0px',color:'rgb(124, 58, 237)',shadow:'none'},'only the left and right instructional lines are drawn');
      assert.equal(await page.locator('#lesson-sequence .is-current').innerText(),'Fa','Lithuanian piano sequence shows solfege without keyboard letters');
      await page.locator('#language-select').selectOption('sv');
      await page.clock.runFor(20);
      assert.equal(await page.locator('#lesson-sequence .is-current').innerText(),'F · F','Swedish keeps note and keyboard letters');
      await page.locator('#language-select').selectOption('lt');
      await page.clock.runFor(20);
      await page.locator('[data-octave-shift="-1"]').click();
      await page.clock.runFor(20);
      assert(await page.locator('#lesson-sequence').isHidden(),'the sequence hides when the octave omits lesson keys');
      await page.locator('[data-octave-shift="1"]').click();
      await page.clock.runFor(20);
      assert(await page.locator('#lesson-sequence').isVisible(),'returning to the matching octave restores the sequence');
    }
    await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
  }
  if(kit==='salamander-v1'){
    await page.clock.pauseAt(await page.evaluate(()=>Date.now()+50));
    await page.locator('.lesson-card').first().getByRole('button',{name:'Normalus',exact:true}).click();
    await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
    const before=await page.evaluate(()=>window.lessonDemoSounds.length);
    await page.locator('#listen-lesson').click();
    await wait(()=>page.evaluate(count=>window.lessonDemoSounds.length>count,before));
    await page.clock.runFor(14*520+40);
    await page.clock.runFor(1.65*520+40);
    const releaseLengths=await page.evaluate(before=>{
      const starts=window.lessonDemoSounds;
      return [0,14].map(index=>{
        const started=starts[before+index];
        const release=window.lessonDemoReleases.find(release=>release.started===started);
        return release ? release.at-started : null;
      });
    },before);
    assert(Math.abs(releaseLengths[0]-.8*520)<=12,'preview quarter notes release at their written hold');
    assert(Math.abs(releaseLengths[1]-1.65*520)<=12,'preview sustained notes use their separate written hold');
    assert.equal(await page.evaluate(()=>window.lessonDemoSounds.length),before+15,'the preview leaves the written phrase break silent');
    await page.clock.runFor(200);
    assert.equal(await page.evaluate(()=>window.lessonDemoSounds.length),before+16,'the next phrase starts after the rest');
    await page.locator('#listen-lesson').click();
    await startSelectedLesson();
    await page.clock.fastForward(14*520+600);
    await page.clock.runFor(20);
    assert.equal(await page.locator('[data-key="d4"].lesson-cue').count(),1,'the lesson holds its long note beyond a quarter-note interval');
    await page.clock.fastForward(300);
    await page.clock.runFor(20);
    assert.equal(await page.locator('.lesson-cue').count(),0,'the written rest releases all visual cues');
    await page.clock.fastForward(150);
    await page.clock.runFor(20);
    assert.equal(await page.locator('[data-key="e4"].lesson-cue').count(),1,'visual guidance starts the next phrase on the same musical beat as the preview');
    await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
    await page.clock.resume();
  }
  await page.locator('.lesson-speed').first().click();
  await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
  const beforeNavigationPreview=await page.evaluate(()=>window.lessonDemoSounds.length);
  await page.locator('#listen-lesson').click();
  await wait(()=>page.evaluate(count=>window.lessonDemoSounds.length>count,beforeNavigationPreview));
  const previewAlternate=kit==='salamander-v1'?'stage-v1':'salamander-v1';
  await clickInstrument(page,previewAlternate);
  await wait(()=>page.locator('body').getAttribute('data-kit').then(value=>value===previewAlternate));
  await wait(()=>page.locator('#audio-status').isHidden());
  const afterNavigationPreview=await page.evaluate(()=>window.lessonDemoSounds.length);
  await page.clock.fastForward(3000);
  assert.equal(await page.evaluate(()=>window.lessonDemoSounds.length),afterNavigationPreview,'changing instruments cancels the lesson demo');
  assert.equal(await page.locator('#lesson-start').count(),0,'a demo starter does not leak into another instrument');
  await clickInstrument(page,kit);
  await wait(()=>page.locator('body').getAttribute('data-kit').then(value=>value===kit));
  await wait(()=>page.locator('#audio-status').isHidden());
  const lessonInput=kit==='salamander-v1'?await context.newCDPSession(page):null;
  const pressLessonKey=async key=>{
    const target=page.locator(`.kit .set [data-key="${key}"]`);
    if(lessonInput){
      await target.scrollIntoViewIfNeeded();
      const box=await target.boundingBox();
      await lessonInput.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height*.8,id:1}]});
    }else if(mobile)await target.tap();
    else await target.click();
  };
  const releaseLessonKey=async()=>{
    if(lessonInput)await lessonInput.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  await page.locator('.lesson-speed').first().click();
  await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
  await startSelectedLesson();
  const delayedKey=kit==='salamander-v1'?'e4':'l';
  assert.equal(await page.locator('#lesson-sequence .lesson-sequence-note').count(),7,'the sequence reserves three past, one current and three future positions');
  assert.equal(await page.locator('#lesson-sequence .lesson-sequence-note.is-empty').count(),3,'a new lesson has no invented past notes');
  assert.equal(await page.locator('#lesson-sequence .lesson-sequence-note').nth(3).getAttribute('aria-current'),'step','the current note is always in the middle');
  if(kit==='salamander-v1')assert.equal(await page.locator('#lesson-sequence .is-current').textContent(),'Mi 2','Lithuanian white notes omit keyboard letters and group repeats');
  const skippedKey=kit==='salamander-v1'?'g4':'s';
  await pressLessonKey(skippedKey);
  assert(await page.locator(`.kit .set [data-key="${skippedKey}"]`).evaluate(element=>element.classList.contains('lesson-wrong')),'anticipation does not skip a still-pending note in the sequence');
  await releaseLessonKey();
  await pressLessonKey(delayedKey);
  assert(await page.locator(`.kit .set [data-key="${delayedKey}"]`).evaluate(element=>element.classList.contains('lesson-correct')),'the current note is green');
  await releaseLessonKey();
  await page.clock.fastForward(150);
  const anticipatedKey=kit==='salamander-v1'?'e4':'s';
  await pressLessonKey(anticipatedKey);
  assert(await page.locator(`.kit .set [data-key="${anticipatedKey}"]`).evaluate(element=>element.classList.contains('lesson-early')),'the immediately upcoming correct note is yellow when played early');
  await releaseLessonKey();
  if(kit==='salamander-v1')assert.equal(await page.locator('[data-key="e4"]').evaluate(element=>element.classList.contains('lesson-early')),false,'yellow piano feedback clears on release');
  const nextAnticipatedKey=kit==='salamander-v1'?'f4':'j';
  await page.clock.runFor(20);
  assert.equal(await page.locator('#lesson-sequence .lesson-sequence-note.is-current').getAttribute('data-notes'),nextAnticipatedKey,'the visible sequence advances after an early correct press');
  assert.equal(await page.locator('#lesson-sequence .is-due').count(),0,'an upcoming central note waits for its scheduled time before growing');
  await pressLessonKey(nextAnticipatedKey);
  assert(await page.locator(`.kit .set [data-key="${nextAnticipatedKey}"]`).evaluate(element=>element.classList.contains('lesson-early')),'consecutive early correct notes keep advancing the lesson');
  await releaseLessonKey();
  await page.clock.runFor(20);
  assert.equal(await page.locator('#lesson-sequence .is-past.result-correct').count(),kit==='salamander-v1'?0:1,'group history retains green borders for fully on-time groups');
  assert.equal(await page.locator('#lesson-sequence .is-past.result-early').count(),2,'group history retains a yellow border when an early note was included');
  const spacing=kit==='salamander-v1'?1400:700;
  await page.clock.fastForward(spacing-150);
  await page.clock.runFor(20);
  assert.equal(await page.locator('.lesson-cue').count(),0,'the next cue keeps the full selected interval after an early note');
  await page.clock.fastForward(180);
  await page.clock.runFor(20);
  const followingKey=kit==='salamander-v1'?'g4':'s';
  assert(await page.locator(`.kit .set [data-key="${followingKey}"]`).evaluate(element=>element.classList.contains('lesson-cue')),'the musical clock resumes from the early press');
  await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
  assert.equal(await page.locator('#lesson-sequence').count(),0,'stopping a lesson removes its sequence');
  await page.locator('.lesson-speed').first().click();
  await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
  await startSelectedLesson();
  await page.clock.fastForward(kit==='salamander-v1'?600:350);
  if(kit==='salamander-v1')assert(await page.locator('[data-key="e4"]').evaluate(element=>element.classList.contains('lesson-cue')),'a slow lesson cue remains visible during its response window');
  await pressLessonKey(delayedKey);
  assert(await page.locator(`.kit .set [data-key="${delayedKey}"]`).evaluate(element=>element.classList.contains('lesson-correct')),'a delayed response before the next note and within one second is accepted');
  await releaseLessonKey();
  await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
  if(kit==='salamander-v1'){
    // Use five identical notes to distinguish catch-up from scoring the newest cue.
    await page.evaluate(async()=>{
      const entry=new URL(document.querySelector('script[src*="app.js"]').src);
      const {lessonsForKit}=await import(new URL('./lessons.js'+entry.search,entry).href);
      const definition=lessonsForKit('salamander-v1')[0];
      window.originalTimingEvents=definition.events;
      window.originalTimingDuration=definition.durationBeats;
      delete definition.durationBeats;
      definition.events=[...Array.from({length:5},(_,beat)=>({key:'e4',beat})),{key:'f4',beat:5},{key:'g4',beat:6}];
    });
    await page.locator('.lesson-speed').first().click();
    await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
    await startSelectedLesson();
    await page.clock.fastForward(2900);
    assert.equal(await page.locator('[data-key="e4"] .lesson-repeat-count').textContent(),'5','missed repetitions remain included in the count');
    for(const [press,result] of ['early','early','correct','early','early'].entries()){
      await pressLessonKey('e4');
      const remaining=4-press;
      const count=page.locator('[data-key="e4"] .lesson-repeat-count');
      if(remaining>1)assert.equal(await count.textContent(),String(remaining),'each accepted press reduces the remaining count by one');
      else assert.equal(await count.count(),0,'one remaining press has no number');
      assert.equal(await page.locator('[data-key="e4"].lesson-'+result).count(),1,'five repeated notes can be caught up in order from late yellow to green and then early yellow');
      await releaseLessonKey();
      await page.clock.runFor(20);
    }
    assert.equal(await page.locator('#lesson-sequence .is-current').getAttribute('data-notes'),'f4','five presses consume exactly five repetitions');
    assert.equal(await page.locator('#lesson-sequence .is-past.result-early').count(),1,'late and early repetitions retain yellow history');
    await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
    await page.locator('.lesson-speed').first().click();
    await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
    await startSelectedLesson();
    await page.clock.fastForward(7100);
    await pressLessonKey('e4');
    assert.equal(await page.locator('[data-key="e4"].lesson-wrong').count(),1,'missed repetitions expire as soon as the different note begins');
    await releaseLessonKey();
    await pressLessonKey('f4');
    assert.equal(await page.locator('[data-key="f4"].lesson-correct').count(),1,'the different note can be played without catching up expired repetitions');
    await releaseLessonKey();
    await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
    await page.locator('.lesson-card').first().getByRole('button',{name:'Normalus',exact:true}).click();
    await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
    await startSelectedLesson();
    await page.clock.fastForward(3680);
    await pressLessonKey('g4');
    assert.equal(await page.locator('[data-key="g4"].lesson-wrong').count(),1,'the final note expires when the next loop starts with a different note');
    await releaseLessonKey();
    await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
    await page.evaluate(async()=>{
      const entry=new URL(document.querySelector('script[src*="app.js"]').src);
      const {lessonsForKit}=await import(new URL('./lessons.js'+entry.search,entry).href);
      lessonsForKit('salamander-v1')[0].events=[{key:'cs4',beat:0},{key:'cs4',beat:1},{key:'d4',beat:2}];
    });
    await page.locator('.lesson-speed').first().click();
    await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
    await startSelectedLesson();
    const blackCount=page.locator('[data-key="cs4"] .lesson-repeat-count');
    assert.equal(await blackCount.textContent(),'2','black keys also show repeated presses');
    assert(await blackCount.isVisible());
    assert.equal(await blackCount.evaluate(label=>getComputedStyle(label).color),'rgb(244, 247, 252)','black key numbers are nearly white');
    await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
    assert.equal(await page.locator('.lesson-repeat-count').count(),0,'stopping a lesson removes the numbers');
    await page.evaluate(async()=>{
      const entry=new URL(document.querySelector('script[src*="app.js"]').src);
      const {lessonsForKit}=await import(new URL('./lessons.js'+entry.search,entry).href);
      lessonsForKit('salamander-v1')[0].events=window.originalTimingEvents;
      lessonsForKit('salamander-v1')[0].durationBeats=window.originalTimingDuration;
      delete window.originalTimingDuration;
      delete window.originalTimingEvents;
    });
    for(const [tempo,releaseAt,advance] of [['Normalus',450,100],['Greitas',260,80]]){
      await page.locator('.lesson-card').first().getByRole('button',{name:tempo,exact:true}).click();
      await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
      await page.clock.pauseAt(await page.evaluate(()=>Date.now()+50));
      const idleShadow=await page.locator('[data-key="e4"]').evaluate(key=>{key.getAnimations().forEach(animation=>animation.finish());return getComputedStyle(key).boxShadow;});
      await startSelectedLesson();
      const cueStyle=await page.locator('.lesson-cue').first().evaluate(element=>{
        const read=()=>{element.getAnimations().forEach(animation=>animation.finish());const style=getComputedStyle(element);return {outline:style.outlineStyle,shadow:style.boxShadow,transform:style.transform};};
        const cue=read(),wasPressed=element.classList.contains('pressed');
        element.classList.remove('lesson-cue');element.classList.add('pressed');
        const pressed=read();
        element.classList.toggle('pressed',wasPressed);element.classList.add('lesson-cue');
        return {...cue,pressed};
      });
      assert.notEqual(cueStyle.transform,'none','a repeated lesson note visibly depresses the key');
      assert.equal(cueStyle.transform,cueStyle.pressed.transform,'repeated cues reuse the real key press movement');
      assert.equal(cueStyle.shadow,cueStyle.pressed.shadow,'repeated cues reuse the inset key depth, without an outer glow');
      const [stripBox,keyboardBox]=await Promise.all([page.locator('#lesson-sequence').boundingBox(),page.locator('.piano-keyboard').boundingBox()]);
      assert(stripBox.y-keyboardBox.y<=28,'portrait and desktop note sequence stays near the top of the keyboard');
      await page.clock.fastForward(releaseAt);
      await page.clock.runFor(20);
      assert.equal(await page.locator('[data-key="e4"].lesson-cue').count(),0,'a repeated note visibly releases before the next press');
      assert.equal(await page.locator('[data-key="e4"]').evaluate(key=>getComputedStyle(key).boxShadow),idleShadow,'the release has no lingering shadow before the repeated cue');
      await pressLessonKey('e4');
      assert(await page.locator('[data-key="e4"]').evaluate(key=>key.classList.contains('lesson-correct')),'the visual release does not shorten the response window');
      await page.clock.fastForward(advance);
      await page.clock.runFor(20);
      assert.equal(await page.locator('[data-key="e4"].lesson-cue').count(),1,'the same key lights again for its next occurrence');
      assert.equal(await page.locator('[data-key="e4"].lesson-correct').count(),1,'the held successful press keeps its green feedback');
      const nextCue=await page.locator('[data-key="e4"]').evaluate(key=>({edge:getComputedStyle(key,'::after').borderLeftWidth,color:getComputedStyle(key,'::after').borderLeftColor,background:getComputedStyle(key).backgroundColor}));
      assert.equal(nextCue.edge,'2px','the next instructional side line is visible while the first note is still held');
      assert.equal(nextCue.color,'rgb(124, 58, 237)','the repeated instruction contrasts with green feedback');
      assert.equal(nextCue.background,'rgb(140, 213, 189)','the violet instruction is drawn over the green success background');
      await releaseLessonKey();
      await pressLessonKey('e4');
      assert.equal(await page.locator('[data-key="e4"].lesson-correct').count(),1,'the repeated note needs its own successful press');
      await releaseLessonKey();
      await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
      await page.clock.resume();
    }
  }
  await page.locator('.lesson-speed').first().click();
  await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
  await startSelectedLesson();
  await page.clock.fastForward(kit==='salamander-v1'?1050:750);
  const expiredWrongKey=kit==='salamander-v1'?'cs4':'w';
  await pressLessonKey(expiredWrongKey);
  assert(await page.locator(`.kit .set [data-key="${expiredWrongKey}"]`).evaluate(element=>element.classList.contains('lesson-wrong')),'a note outside the current response window and next beat is red');
  await releaseLessonKey();
  await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
  const lastNote=await page.evaluate(async kit=>{
    const {lessonsForKit,lessonSpeeds}=await import('./lessons.js');
    const note=lessonsForKit(kit)[0].events.at(-1);
    return {key:note.key,time:note.beat*lessonSpeeds[0].beatMs,hold:note.duration !== undefined ? note.duration*lessonSpeeds[0].beatMs : 1000};
  },kit);
  await page.locator('.lesson-speed').first().click();
  await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
  await startSelectedLesson();
  await page.clock.fastForward(lastNote.time+lastNote.hold-200);
  assert(await page.locator(`.kit .set [data-key="${lastNote.key}"]`).evaluate(element=>element.classList.contains('lesson-cue')),'the final cue lasts for its written hold (or one second for drums)');
  assert.equal(await page.locator('#lesson-sequence .is-past.result-wrong').count(),3,'unplayed notes appear as dimmed red history');
  await page.clock.fastForward(250);
  assert.equal(await page.locator(`.kit .set [data-key="${lastNote.key}"]`).evaluate(element=>element.classList.contains('lesson-cue')),false,'the final cue releases at its written ending');
  await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
  await page.locator('.lesson-speed').first().click();
  await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
  await startSelectedLesson();
  await wait(()=>page.locator('.lesson-cue').count().then(count=>count>0));
  assert(await page.locator('.lesson-card.is-playing').count(),'a lesson highlights the next instrument key');
  const promptedKey=await page.locator('.lesson-cue').first().getAttribute('data-key');
  if(lessonInput){
    await page.locator('.piano-keyboard').scrollIntoViewIfNeeded();
    const black=await page.locator('[data-key="ds4"]').boundingBox();
    assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.piano-key')?.dataset.key,{x:black.x+black.width*.2,y:black.y+black.height*.5}),'ds4','a glowing white cue remains behind its overlapping black key');
  }
  await pressLessonKey(promptedKey);
  assert(await page.locator(`.kit .set [data-key="${promptedKey}"]`).evaluate(button=>button.classList.contains('lesson-correct')),'an on-time note is green');
  if(kit==='salamander-v1'){
    assert.equal(await page.locator(`[data-key="${promptedKey}"]`).evaluate(button=>getComputedStyle(button).backgroundColor),'rgb(140, 213, 189)','correct lesson feedback changes only the key background');
    assert.equal(await page.locator(`[data-key="${promptedKey}"]`).evaluate(button=>getComputedStyle(button).outlineStyle),'none','correct lesson feedback adds no outline');
    await page.clock.runFor(600);
    assert(await page.locator(`[data-key="${promptedKey}"]`).evaluate(button=>button.classList.contains('lesson-correct')),'green feedback stays visible while a piano key is held');
  }
  await releaseLessonKey();
  if(lessonInput)assert.equal(await page.locator('.lesson-correct').count(),0,'releasing the piano key clears its feedback immediately');
  const wrongKey=kit==='salamander-v1'?'cs4':'w';
  await pressLessonKey(wrongKey);
  assert(await page.locator(`.kit .set [data-key="${wrongKey}"]`).evaluate(button=>button.classList.contains('lesson-wrong')),'an off-time note is red');
  if(kit==='salamander-v1'){
    assert.equal(await page.locator(`[data-key="${wrongKey}"]`).evaluate(button=>getComputedStyle(button).backgroundColor),'rgb(233, 147, 154)','wrong lesson feedback changes only the key background');
    assert.equal(await page.locator(`[data-key="${wrongKey}"]`).evaluate(button=>getComputedStyle(button).outlineStyle),'none','wrong lesson feedback adds no outline');
  }
  await releaseLessonKey();
  if(lessonInput)assert.equal(await page.locator('.lesson-wrong').count(),0,'releasing a wrong piano note clears its red background');
  await page.clock.fastForward(kit==='salamander-v1'?1450:750);
  assert(await page.locator('.lesson-cue').count(),'the next cue follows its own clock after a user presses');
  assert.equal(await page.locator('.lesson-wrong').count(),0,'missed lesson cues do not automatically flash red');
  if(kit==='salamander-v1'){
    assert(await page.locator('.kit').evaluate(element=>element.classList.contains('lesson-active')),'piano lesson uses its lesson key style');
  }
  await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
  assert.equal(await page.locator('.lesson-cue').count(),0,'stopping a lesson clears every visual cue');
  await page.clock.fastForward(12000);

  await page.locator('.lesson-speed').first().click();
  await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
  await startSelectedLesson();
  for(let index=0;index<9;index++){
    await pressLessonKey(delayedKey);
    await releaseLessonKey();
    if(index<8)await page.clock.fastForward(2000);
  }
  await page.clock.fastForward(12000);
  assert(await page.locator('#recording-bar').isVisible(),'a completed practice offers lesson controls');
  assert.equal(await page.locator('#recording-bar .actions button:visible').count(),2,'practice offers only repeat and exit');
  assert(await page.locator('#commit-recording').isHidden(),'practice has no save option');
  assert.equal(await page.locator('#restart-recording').innerText(),'Pakartoti pamoką');
  await page.locator('#commit-recording').dispatchEvent('click');
  assert.equal(saves,0,'practice cannot be saved even if the hidden save handler is triggered');
  await page.locator('#language-select').selectOption('sv');
  assert.equal(await page.locator('#restart-recording').innerText(),'Öva igen');
  assert.equal(await page.locator('#recording-title').innerText(),'Övningen är klar');
  await page.locator('#language-select').selectOption('lt');
  await page.locator('#restart-recording').click();
  assert(await page.locator('#recording-bar').isHidden(),'repeating practice hides its review');
  await startSelectedLesson();
  await pressLessonKey(delayedKey);
  await releaseLessonKey();
  await page.clock.fastForward(12000);
  assert(await page.locator('#recording-bar').isVisible(),'a repeated practice can finish again');
  assert.equal(await page.locator('#recording-bar .actions button:visible').count(),2);
  await page.locator('#cancel-recording').click();
  assert(await page.locator('#recording-bar').isHidden(),'exiting practice returns to free play');

  if(kit==='salamander-v1'){
    assert.equal(await page.locator('.piano-key').count(),13);
    assert.equal(await page.locator('.piano-key').first().evaluate(element=>element.tagName),'DIV','piano keys use a touch surface instead of native phone buttons');
    assert.equal(await page.locator('[data-key="c4"]').getAttribute('role'),'button','piano keys remain accessible as buttons');
    assert.equal(await page.locator('[data-key="c4"]').getAttribute('aria-disabled'),'false','loaded piano keys are accessible');
    assert.equal(await page.locator('.black-key').count(),5);
    if(mobile){
      const [black,white]=await Promise.all([page.locator('.black-key').first().boundingBox(),page.locator('.white-key').first().boundingBox()]);
      assert(Math.abs(black.height/white.height-.58)<.01,'portrait black keys are 58% of white-key height');
    }
    await page.locator('#language-select').selectOption('sv');
    assert.equal(await page.locator('[data-key="c4"] span').innerText(),'C');
    assert.match(await page.locator('[data-octave-shift="-1"]').innerText(),/Lägre/);
    await page.locator('#language-select').selectOption('lt');
    await page.locator('[data-octave-shift="-1"]').click();
    await page.locator('[data-octave-shift="-1"]').click();
    assert.match(await page.locator('#piano-octave-label').innerText(),/C2–C3/);
    assert.equal(await page.locator('.piano-key').first().getAttribute('data-key'),'c2');
    assert(await page.locator('[data-octave-shift="-1"]').isDisabled());
    for(let i=0;i<4;i++) await page.locator('[data-octave-shift="1"]').click();
    assert.match(await page.locator('#piano-octave-label').innerText(),/C6–C7/);
    assert.equal(await page.locator('.piano-key').last().getAttribute('data-key'),'c7');
    assert.match(await page.locator('[data-octave-shift="1"]').innerText(),/Pilnas/);
    await page.locator('[data-octave-shift="1"]').click();
    assert.match(await page.locator('#piano-octave-label').innerText(),/Pilnas · C2–C7/);
    assert.equal(await page.locator('.piano-key').count(),61);
    assert.equal(await page.locator('.black-key').count(),25);
    assert.equal(await page.locator('.piano-key').first().getAttribute('data-key'),'c2');
    assert.equal(await page.locator('.piano-key').last().getAttribute('data-key'),'c7');
    assert(await page.locator('[data-octave-shift="1"]').isDisabled());
    const [whiteBox,blackBox]=await Promise.all([page.locator('[data-key="c2"]').boundingBox(),page.locator('[data-key="cs2"]').boundingBox()]);
    assert(blackBox.width<whiteBox.width&&blackBox.x>whiteBox.x,'full-range black keys align between white keys');
    await page.keyboard.down('a');
    assert(await page.locator('[data-key="c4"]').evaluate(element=>element.classList.contains('pressed')),'middle octave keyboard shortcuts still work in full view');
    assert.notEqual(await page.locator('[data-key="c4"]').evaluate(element=>getComputedStyle(element).transform),'none','a held piano key moves down like a physical key');
    assert.equal(await page.locator('[data-key="c4"]').evaluate(element=>getComputedStyle(element).borderLeftColor),'rgb(130, 146, 165)','a normal piano press darkens the side borders');
    await page.keyboard.up('a');
    await page.locator('[data-key="c4"]').focus();
    await page.keyboard.press('Enter');
    assert(await page.locator('[data-key="c4"]').evaluate(element=>element.classList.contains('pressed')),'Enter activates a focused piano key');
    await page.clock.runFor(260);
    assert.equal(await page.locator('[data-key="c4"]').evaluate(element=>element.classList.contains('pressed')),false,'accessible piano activation releases automatically');
    for(let i=0;i<3;i++) await page.locator('[data-octave-shift="-1"]').click();
    assert.match(await page.locator('#piano-octave-label').innerText(),/C4–C5/);
    await page.keyboard.down('a');
    await page.clock.runFor(160);
    await page.locator('[data-octave-shift="-1"]').click();
    await page.keyboard.up('a');
    assert.equal(await page.locator('.piano-key.pressed').count(),0,'changing octave releases a held note');
    await page.locator('[data-octave-shift="1"]').click();
    await page.locator('.piano-keyboard').scrollIntoViewIfNeeded();
    const keyCenter=async key=>{
      const box=await page.locator(`[data-key="${key}"]`).boundingBox();
      return {x:box.x+box.width/2,y:box.y+box.height*.72};
    };
    const [c4,e4,g4,a4,b4]=await Promise.all(['c4','e4','g4','a4','b4'].map(keyCenter));
    assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.piano-key')?.dataset.key,a4),'a4','a4 hit target stays reachable');
    await page.evaluate(()=>{
      window.pianoNativeTouchCancelled=false;
      document.addEventListener('touchstart',event=>{if(event.target.closest('.piano-key'))window.pianoNativeTouchCancelled=event.defaultPrevented;});
    });
    const input=await context.newCDPSession(page);
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...c4,id:1},{...e4,id:2},{...g4,id:3},{...b4,id:4}]});
    assert(await page.evaluate(()=>window.pianoNativeTouchCancelled),'touch piano playing suppresses the native button action');
    assert.equal(await page.locator('.piano-key.pressed').count(),4,'four piano keys can be held together');
    await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...e4,x:e4.x-8,id:1},{...e4,x:e4.x+8,id:2},{...g4,id:3},{...b4,id:4}]});
    assert.equal(await page.locator('.piano-key.pressed').count(),3,'two fingers can share a key while the other notes continue');
    await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...e4,x:e4.x-8,id:1},{...a4,id:2},{...g4,id:3},{...b4,id:4}]});
    await wait(()=>page.locator('[data-key="a4"]').evaluate(element=>element.classList.contains('pressed')));
    assert(await page.locator('[data-key="e4"]').evaluate(element=>element.classList.contains('pressed')),'a shared note stays held when one finger slides away');
    assert.deepEqual(await page.locator('.piano-key.pressed').evaluateAll(elements=>elements.map(element=>element.dataset.key).sort()),['a4','b4','e4','g4'],'changing one note preserves the four-key chord');
    const keyboardBox=await page.locator('.piano-keyboard').boundingBox();
    const gap={x:a4.x,y:keyboardBox.y+2};
    await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...e4,x:e4.x-8,id:1},{...gap,id:2},{...g4,id:3},{...b4,id:4}]});
    await wait(()=>page.locator('[data-key="a4"]').evaluate(element=>!element.classList.contains('pressed')));
    assert.equal(await page.locator('[data-key="a4"]').evaluate(element=>element.classList.contains('pressed')),false,'leaving a key releases its note');
    await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...e4,x:e4.x-8,id:1},{...c4,id:2},{...g4,id:3},{...b4,id:4}]});
    await wait(()=>page.locator('[data-key="c4"]').evaluate(element=>element.classList.contains('pressed')));
    assert(await page.locator('[data-key="c4"]').evaluate(element=>element.classList.contains('pressed')),'returning across a gap plays a new note without lifting the finger');
    await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.equal(await page.locator('.piano-key.pressed').count(),0,'lifting fingers releases all piano keys');
    await page.evaluate(()=>{
      window.testPianoSources=[];
      if(!window.AudioContext){
        const play=HTMLMediaElement.prototype.play;
        const pause=HTMLMediaElement.prototype.pause;
        HTMLMediaElement.prototype.play=function(...args){
          const audio=this;
          const source={audio,testStops:[],stop(){audio.pause();audio.dispatchEvent(new Event('ended'));}};
          audio.testSource=source;
          window.testPianoSources.push(source);
          return play.apply(audio,args);
        };
        HTMLMediaElement.prototype.pause=function(...args){
          this.testSource?.testStops.push(args);
          return pause.apply(this,args);
        };
        return;
      }
      const original=AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource=function(...args){
        const source=original.apply(this,args);
        const stop=source.stop.bind(source);
        source.testStops=[];
        source.stop=(...args)=>{source.testStops.push(args);return stop(...args);};
        window.testPianoSources.push(source);
        return source;
      };
    });
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...c4,id:1},{...e4,id:2}]});
    assert.equal(await page.evaluate(()=>window.testPianoSources.length),2,'two held notes have independent audio voices');
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...c4,id:1},{...e4,id:2},{...g4,id:3}]});
    const gestureScroll=await page.evaluate(()=>window.scrollY);
    const gestureScale=await page.evaluate(()=>window.visualViewport.scale);
    for(const [note,moving] of [['a4',a4],['b4',b4],['g4',g4],['a4',a4],['b4',b4],['g4',g4]]){
      await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...c4,id:1},{...e4,id:2},{...moving,id:3}]});
      await wait(()=>page.locator('.piano-key.pressed').evaluateAll((elements,note)=>elements.length===3&&['c4','e4',note].every(key=>elements.some(element=>element.dataset.key===key)),note));
      assert(await page.evaluate(()=>window.testPianoSources.slice(0,2).every(source=>source.testStops.length===0)),'changing the third note never stops either held audio voice');
    }
    assert.equal(await page.evaluate(()=>window.scrollY),gestureScroll,'changing a third note does not scroll the instrument');
    assert.equal(await page.evaluate(()=>window.visualViewport.scale),gestureScale,'changing a third note does not zoom the page');
    await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const heldStart=await page.evaluate(()=>window.testPianoSources.length);
    await page.keyboard.down('a');
    await page.keyboard.down('d');
    for(const shortcut of ['w','s','e','w','s','e','w','s','e'])await page.keyboard.press(shortcut);
    assert(await page.evaluate(start=>window.testPianoSources.slice(start,start+2).every(source=>source.testStops.length===0),heldStart),'repeated notes sharing samples never steal a held voice');
    assert(await page.locator('[data-key="c4"]').evaluate(element=>element.classList.contains('pressed')),'the first shared sample stays held');
    assert(await page.locator('[data-key="e4"]').evaluate(element=>element.classList.contains('pressed')),'the second shared sample stays held');
    await page.keyboard.up('a');
    await page.keyboard.up('d');
    const chordStart=await page.evaluate(()=>window.testPianoSources.length);
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...c4,id:1},{...e4,id:2},{...g4,id:3}]});
    await new Promise(resolve=>setTimeout(resolve,650));
    assert.equal(await page.locator('.piano-key.pressed').count(),3,'three simultaneous fingers remain held beyond the long-press threshold');
    assert(await page.evaluate(start=>window.testPianoSources.slice(start,start+3).every(source=>source.testStops.length===0),chordStart),'a simultaneous three-note chord does not stop its audio voices');
    await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const edgeChord=await Promise.all(['e4','f4','g4'].map(async(key,index)=>{
      const box=await page.locator(`[data-key="${key}"]`).boundingBox();
      return {x:box.x+box.width/2,y:box.y+1,id:index+1};
    }));
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:edgeChord});
    await new Promise(resolve=>setTimeout(resolve,120));
    await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:edgeChord.map(point=>({...point,x:point.x+1}))});
    assert.equal(await page.locator('.piano-key.pressed').count(),3,'Mi-Fa-Sol hit areas stay stable after the press animation');
    await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    if(mobile){
      const portrait=page.viewportSize();
      await page.setViewportSize({width:915,height:412});
      const chord=await Promise.all(['e4','f4','g4','a4','b4'].map(async(key,index)=>{
        const box=await page.locator(`[data-key="${key}"]`).boundingBox();
        return {x:box.x+box.width/2,y:box.y+box.height*.8,id:index+1};
      }));
      for(const count of [3,4,5]){
        const points=chord.slice(0,count);
        const sourceStart=await page.evaluate(()=>window.testPianoSources.length);
        await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
        await new Promise(resolve=>setTimeout(resolve,150));
        await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points.map(point=>({...point,x:point.x+1}))});
        assert.equal(await page.locator('.piano-key.pressed').count(),count,`${count} adjacent piano notes remain held in landscape`);
        assert(await page.evaluate(start=>window.testPianoSources.slice(start).every(source=>source.testStops.length===0),sourceStart),'adjacent landscape notes retain all of their audio voices');
        await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }
      await page.setViewportSize(portrait);
      await page.locator('.piano-keyboard').scrollIntoViewIfNeeded();
    }
    await page.keyboard.down('a');
    assert(await page.locator('[data-key="c4"]').evaluate(element=>element.classList.contains('pressed')),'held piano key starts a sample');
    await page.evaluate(()=>window.testPianoSources.at(-1).stop());
    await wait(()=>page.locator('[data-key="c4"]').evaluate(element=>!element.classList.contains('pressed')));
    const beforeReplay=await page.evaluate(()=>window.testPianoSources.length);
    await page.locator('[data-key="c4"]').click();
    assert(await page.evaluate(count=>window.testPianoSources.length>count,beforeReplay),'another touch can replay a note while the original key is still held');
    await page.keyboard.up('a');
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
  await page.locator('.lesson-speed').first().click();
  await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
  assert(await page.locator('#recording-bar').isHidden(),'choosing a lesson discards an unfinished take immediately');
  await page.locator('.lesson-card.is-playing').getByRole('button',{name:'Stabdyti pamoką'}).click();
  await strike(firstKey);
  assert(await page.locator('#recording-bar').isHidden(),'modal stays hidden while recording');
  if(kit==='salamander-v1'){
    await page.clock.fastForward(3190);
    assert(await page.locator('#recording-bar').isHidden(),'piano waits three seconds after its release tail');
    await page.clock.fastForward(20);
  }else await page.clock.fastForward(12000);
  assert(await page.locator('#recording-bar').isHidden(),'a short accidental hit is discarded without a recording modal');
  const playLongEnough=async strikeNote=>{
    await strike(strikeNote);
    for(let i=0;i<8;i++) {
      await page.clock.fastForward(2000);
      await strike(strikeNote);
    }
  };
  await playLongEnough(firstKey);
  await page.clock.fastForward(12000);
  await wait(()=>page.locator('#recording-bar').isVisible());
  assert.match(await page.locator('#recording-title').textContent(),/Ritmas 1 · Pabaiga/);
  assert.equal(await page.locator('#recording-bar .actions button:visible').count(),3);
  assert.match(await page.locator('#commit-recording').innerText(),/Įrašyti į Ritmas 1/);
  await page.locator('#language-select').selectOption('sv');
  assert.match(await page.locator('#recording-title').innerText(),/Inspelningen är klar/);
  assert.match(await page.locator('#recording-title').innerText(),/Rytm 1/);
  assert.match(await page.locator('#commit-recording').innerText(),/Spara i Rytm 1/);
  assert.deepEqual(await untranslatedPublicText(page),[],'recording review is fully translated');
  await page.locator('#language-select').selectOption('lt');

  await page.locator('#restart-recording').click();
  assert(await page.locator('#recording-bar').isHidden());
  await strike(firstKey);
  for(let i=0;i<61;i++){
    await page.clock.fastForward(2000);
    await strike(firstKey);
    assert(await page.locator('#recording-bar').isHidden(),'short pauses keep recording beyond two minutes');
  }
  await page.clock.fastForward(12000);
  await wait(()=>page.locator('#recording-bar').isVisible());
  await page.locator('#commit-recording').click();
  await wait(()=>saves===1);
  await wait(()=>page.locator('#recording-bar').isHidden());
  assert.equal(recordings.get(own+':1').kit,kit);
  assert(recordings.get(own+':1').duration_ms>120000,'long recordings include notes and held lengths after two minutes');
  await page.locator('#language-select').selectOption('sv');
  assert.match(await page.locator('#rhythm-count').innerText(),/rytmer/);
  assert.equal(await page.locator('#community-title').innerText(),'Våra rytmer');
  assert.equal(await page.locator(`[data-owner="${own}"] .play-rhythm`).first().innerText(),'Spela upp');
  assert.match(await page.locator('#status').innerText(),/”Rytm 1” har sparats/);
  assert.match(await page.locator('.version').innerText(),/Version/);
  assert.equal(await page.locator('#app-version').count(),1,'version number survives language changes');
  assert.deepEqual(await untranslatedPublicText(page),[],'signed-in interface is fully translated');
  await page.locator('[data-kit-link="salamander-v1"]').click();
  await wait(()=>page.locator('body').getAttribute('data-kit').then(value=>value==='salamander-v1'));
  assert.match(await page.locator('#title').innerText(),/Salamanderpiano/);
  assert.equal(await page.locator('.lesson-card').count(),4,'switching to piano replaces drum lessons');
  assert.equal(await page.locator('html').getAttribute('lang'),'sv');
  assert.deepEqual(await untranslatedPublicText(page),[],'instrument switch keeps translations');
  await clickInstrument(page,kit);
  await wait(()=>page.locator('body').getAttribute('data-kit').then(value=>value===kit));
  assert.equal(await page.locator('.lesson-card').count(),4,'switching back restores this instrument’s lessons');
  await page.locator('#language-select').selectOption('lt');

  await playLongEnough(firstKey);
  await page.clock.fastForward(12000);
  await wait(()=>page.locator('#recording-bar').isVisible());
  assert.match(await page.locator('#recording-title').textContent(),/Ritmas 2 · Pabaiga/);
  await page.locator('#cancel-recording').click();
  assert(await page.locator('#recording-bar').isHidden());
  assert(!(await page.locator('.lesson-speed').first().isDisabled()),'leaving a recording restores lesson controls');
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
  const navigationKit=kit==='salamander-v1'?'stage-v1':kit;
  await clickInstrument(page,navigationKit);
  await wait(()=>page.locator('body').getAttribute('data-kit').then(id=>id===navigationKit));
  await wait(()=>page.locator('#audio-status').isHidden());
  const alternate=navigationKit==='virtuosity-v1'?'classic-v1':'virtuosity-v1';
  const alternateFile=alternate==='classic-v1'?'classic.html':'studio.html';
  const choose=async id=>{
    await clickInstrument(page,id);
    await wait(()=>page.locator('body').getAttribute('data-kit').then(value=>value===id));
    await wait(()=>page.locator('#audio-status').isHidden());
    assert.equal(await page.locator('.kit-tabs a').count(),2,'sound choices never add instrument tabs');
    if(id!=='salamander-v1'){
      assert.equal(await page.locator('body.stage-kit').count(),1,'all drum sounds share the stage design');
      assert.equal(await page.locator('[data-drum-shift]').count(),2,'previous and next sound controls stay available');
      const label={'classic-v1':'Klasikiniai','virtuosity-v1':'Virtuosity','stage-v1':'Studijiniai'}[id];
      assert.equal(await page.locator('#drum-sound-label').innerText(),label,'the selected sound collection is visible');
    }
  };
  const playCurrent=async()=>{
    const current=await page.locator('body').getAttribute('data-kit');
    if(current==='salamander-v1'){
      await page.keyboard.down('a');await page.clock.runFor(220);await page.keyboard.up('a');
    }else if(mobile)await page.locator('.drum').first().tap();
    else await page.locator('.drum').first().click();
  };
  const playCurrentLongEnough=async()=>{
    await playCurrent();
    for(let i=0;i<8;i++) {
      await page.clock.fastForward(2000);
      await playCurrent();
    }
  };
  // A failed fragment fetch leaves the current instrument usable and does not reload login.
  await context.route(base+'/'+alternateFile,route=>route.abort());
  await playCurrent();
  await clickInstrument(page,alternate);
  await wait(()=>page.locator('#status').innerText().then(text=>text.includes('Instrumento įkelti nepavyko')));
  assert.equal(await page.locator('body').getAttribute('data-kit'),navigationKit);
  await wait(()=>page.locator('#audio-status').isHidden());
  await context.unroute(base+'/'+alternateFile);
  const notesBefore=await page.evaluate(()=>window.liveNotes);
  await playCurrent();
  assert.equal(await page.evaluate(()=>window.liveNotes),notesBefore+1,'recovery must not bind duplicate input listeners');
  // A slow earlier response must not replace the user's newer selection.
  let delayed;
  await context.route(base+'/'+alternateFile,route=>{delayed=route;});
  await clickInstrument(page,alternate);
  await wait(()=>!!delayed);
  await choose(navigationKit);
  await delayed.fulfill({contentType:'text/html',body:await fs.readFile(path.join(root,alternateFile),'utf8')});
  await context.unroute(base+'/'+alternateFile);
  await page.clock.runFor(100);
  assert.equal(await page.locator('body').getAttribute('data-kit'),navigationKit);

  for(const next of [alternate,'salamander-v1','classic-v1','virtuosity-v1','stage-v1',kit]){
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
    assert.equal(new URL(page.url()).pathname.split('/').at(-1),next==='salamander-v1'?'piano.html':next==='virtuosity-v1'?'studio.html':next==='stage-v1'?'stage.html':'classic.html');
  }
  await page.clock.fastForward(12000);
  assert(await page.locator('#recording-bar').isHidden(),'old silence timers are cleared');
  // Switching from the review overlay also discards, rather than saving, the draft.
  await playCurrentLongEnough();
  await page.clock.fastForward(12000);
  await wait(()=>page.locator('#recording-bar').isVisible());
  const reviewAlternate=kit==='salamander-v1'?await page.locator('[data-instrument="drums"]').getAttribute('data-kit-link'):'salamander-v1';
  await choose(reviewAlternate);
  assert(await page.locator('#recording-bar').isHidden());
  assert.equal(saves,1);
  await page.goBack();
  await wait(()=>page.locator('body').getAttribute('data-kit').then(value=>value===kit));
  await wait(()=>page.locator('#audio-status').isHidden());
  await page.goForward();
  await wait(()=>page.locator('body').getAttribute('data-kit').then(value=>value===reviewAlternate));
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
  await playCurrentLongEnough();
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
    const portraitPageHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
    const portraitViewportHeight=await page.evaluate(()=>window.innerHeight);
    assert(portraitPageHeight>portraitViewportHeight,'a vertical phone page has content below the fold');
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    assert(await page.evaluate(()=>window.scrollY>0),'a vertical phone page remains scrollable');
    await page.evaluate(()=>window.scrollTo(0,0));
    assert.equal(await page.locator('.drum, .piano-key').first().evaluate(e=>getComputedStyle(e).touchAction),'none','portrait instrument blocks browser gestures while the page outside remains scrollable');
    await page.setViewportSize({width:915,height:412});
    assert.equal(await page.locator('body > header').evaluate(e=>getComputedStyle(e).display),'none');
    const kitBox=await page.locator('.kit').boundingBox();
    assert(kitBox.width>=910&&kitBox.height>=407,'instrument fills a rotated phone');
    const setBox=await page.locator('.set').boundingBox();
    assert(setBox.width>=910&&setBox.height>=407,'keys or drums use the full instrument area');
    assert.equal(await page.locator('.drum, .piano-key').first().evaluate(e=>getComputedStyle(e).touchAction),'none','landscape gestures belong to the instrument');
    if(kit==='salamander-v1'){
      const blackKey=page.locator('.black-key').first();
      const [black,white]=await Promise.all([blackKey.boundingBox(),page.locator('.white-key').first().boundingBox()]);
      assert(Math.abs(black.height/white.height-.44)<.01,'black piano keys are 44% of white-key height in landscape');
      await blackKey.evaluate(element=>element.classList.add('pressed'));
      await new Promise(resolve=>setTimeout(resolve,90));
      const pressedBlack=await blackKey.boundingBox();
      assert(Math.abs(pressedBlack.y-black.y)<1,'a pressed black key keeps its top edge hidden in place');
      await blackKey.evaluate(element=>element.classList.remove('pressed'));
      for(let i=0;i<3;i++) await page.locator('[data-octave-shift="1"]').click();
      const fullBox=await page.locator('.piano-keyboard').boundingBox();
      assert.equal(await page.locator('.piano-key').count(),61);
      assert(fullBox.width>=910&&fullBox.height>=407,'the full piano fits the rotated phone');
      await page.locator('[data-octave-shift="-1"]').click();
      await page.locator('[data-octave-shift="-1"]').click();
      await page.locator('[data-octave-shift="-1"]').click();
    }else{
      const input=await context.newCDPSession(page);
      const center=async key=>{const b=await page.locator(`.drum[data-key="${key}"]`).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
      const [snare,kick,tom,otherTom]=await Promise.all(['j','l','w','a'].map(center));
      await page.evaluate(()=>{window.gestureNotes=[];window.addEventListener('drumhit',event=>window.gestureNotes.push(event.detail.key));});
      const initialScroll=await page.evaluate(()=>window.scrollY);
      await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...snare,id:1},{...kick,id:2}]});
      assert.deepEqual(await page.evaluate(()=>[...window.gestureNotes].sort()),['j','l'],'two fingers play two drums together');
      await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...snare,id:1},{...kick,id:2}]});
      assert.equal(await page.evaluate(()=>window.gestureNotes.length),2,'remaining on a pad does not repeat its sound');
      await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...tom,id:1},{...otherTom,id:2}]});
      assert.deepEqual(await page.evaluate(()=>[...window.gestureNotes].sort()),['a','j','l','w'],'each finger can slide onto another drum');
      const gap={x:(snare.x+kick.x)/2,y:snare.y};
      await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...gap,id:1},{...otherTom,id:2}]});
      await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...snare,id:1},{...otherTom,id:2}]});
      await wait(()=>page.evaluate(()=>window.gestureNotes.at(-1)==='j'));
      assert.equal(await page.evaluate(()=>window.gestureNotes.at(-1)),'j','a finger can cross an empty gap and re-enter a pad');
      await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert.equal(await page.evaluate(()=>window.scrollY),initialScroll,'playing in landscape does not scroll the page');
      assert.equal(await page.locator('.set').evaluate(e=>{const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});return e.dispatchEvent(event);}),false,'playing surface suppresses the long-press context menu');
      await page.clock.fastForward(12000);
      assert(await page.locator('#recording-bar').isHidden(),'a short landscape gesture is not offered as a recording');
    }
  }

  await playLongEnough(firstKey);
  await page.locator('#show-lesson-repeat-counts').evaluate(input=>input.click());
  await page.goto(base+'/'+file);
  await wait(()=>page.locator('#audio-status').isHidden());
  if(await page.locator('#login').isVisible()){
    await page.locator('#nickname').evaluate(input=>{
      if(input.closest('#login').hidden)return;
      input.value='Ritmas';
      input.form.requestSubmit();
    });
  }
  await wait(()=>emergencySaves>=1);
  assert.equal(recordings.get(own+':1').events[0].key,firstKey,'closing overwrites the emergency first slot');
  assert(await page.locator('#show-lesson-sequence').isChecked(),'the sequence preference survives a reload');
  assert.equal(await page.locator('#show-lesson-repeat-counts').isChecked(),false,'turning off repetition counts persists after reload');
  const emergencyBeforePractice=emergencySaves;
  await page.locator('.lesson-speed').first().evaluate(button=>button.click());
  await wait(()=>page.locator('#lesson-start').count().then(count=>count===1));
  await startSelectedLesson();
  if(mobile&&kit==='salamander-v1'){
    const [sequenceBox,controlsBox]=await Promise.all([page.locator('#lesson-sequence').boundingBox(),page.locator('.piano-octave-controls').boundingBox()]);
    assert(sequenceBox.y>=controlsBox.y+controlsBox.height,'landscape note sequence sits below piano sound controls');
    assert(sequenceBox.y<100,'landscape note sequence stays near the top of the keyboard');
  }
  for(let index=0;index<9;index++){
    await pressLessonKey(delayedKey);
    await releaseLessonKey();
    if(index<8)await page.clock.fastForward(2000);
  }
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await page.clock.fastForward(500);
  assert.equal(await page.evaluate(()=>localStorage.getItem('bugnai.emergency-draft')),null,'closing during practice does not retain an emergency rhythm');
  assert.equal(emergencySaves,emergencyBeforePractice,'closing during practice never saves to the database');
  assert.deepEqual(errors,[]);
  console.log('PASS',file,mobile?'mobile landscape':'desktop',forceFallback?'HTML Audio fallback':'Web Audio','automatic recording, touch chords/glissando, scrolling, save/repeat/exit, seamless tabs, draft discard, history, fetch failure/race and emergency slot');
  await context.close();
}

async function adminScenario(browser){
  const context=await browser.newContext();
  const page=await context.newPage();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now()+1000));
  let locationStatus='declined';
  let locationAccuracy=8;
  let disconnectedMember=false,disconnectCancellations=0;
  let memberListRequests=0;
  let deleteAttempts=0,deleteFails=false,deleteMissing=false;
  const deletedMembers=new Set();
  let liveSocket;
  let liveJoins=0;
  await page.routeWebSocket('wss://hsqsjxnotqpoodvnxecv.supabase.co/realtime/v1/websocket*',socket=>{
    liveSocket=socket;
    socket.onMessage(message=>{
      const frame=JSON.parse(message);
      assert(!message.includes('test-admin-code'),'administrator secret must never enter the broadcast connection');
      if(frame.event==='phx_join')liveJoins++;
      if(frame.event==='phx_join'||frame.event==='heartbeat')socket.send(JSON.stringify({
        topic:frame.topic,event:'phx_reply',ref:frame.ref,payload:{status:'ok',response:{}}
      }));
    });
  });
  const locationChanged=()=>liveSocket.send(JSON.stringify({
    topic:'realtime:admin-location-updates',event:'broadcast',payload:{event:'location_changed',payload:{}}
  }));
  await context.route('https://hsqsjxnotqpoodvnxecv.supabase.co/**',route=>{
    if(new URL(route.request().url()).pathname.endsWith('/admin_delete_member')){
      deleteAttempts++;
      const body=route.request().postDataJSON();
      assert.equal(body.p_code,'test-admin-code-123');
      assert.equal(body.p_member_id,other);
      if(deleteMissing)return route.fulfill({status:404,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({code:'PGRST202',message:'Could not find the function public.admin_delete_member'})});
      if(!deleteFails)deletedMembers.add(body.p_member_id);
      return route.fulfill({status:deleteFails?503:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:deleteFails?JSON.stringify({message:'Try again'}):'null'});
    }
    if(new URL(route.request().url()).pathname.endsWith('/admin_cancel_location_request')){
      disconnectCancellations++;
      locationStatus='cancelled';
      return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:'null'});
    }
    memberListRequests++;
    const rows=[
      {id:own,nickname:'Ritmas',created_at:new Date().toISOString(),last_seen_at:disconnectedMember?'2026-01-01T00:00:00Z':new Date().toISOString(),location_requested_at:'2026-10-21T10:00:00Z',rhythm_count:1,device_type:'Telefonas',os_name:'Android',browser_name:'Chrome',approx_location:'Vilnius, Lietuva',location_status:locationStatus,exact_latitude:54.680123,exact_longitude:25.280456,exact_accuracy_m:locationAccuracy,location_captured_at:'2026-10-15T12:30:00Z'},
      {id:other,nickname:'Atsijungęs',created_at:new Date().toISOString(),last_seen_at:'2026-01-01T00:00:00Z',rhythm_count:0,location_status:null}
    ];
    route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify(rows.filter(row=>!deletedMembers.has(row.id)))});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/admin.html`);
  await page.locator('#admin-code').fill('test-admin-code-123');
  await page.locator('#admin-login-form').evaluate(form=>form.requestSubmit());
  await wait(()=>page.locator('#member-rows tr').count().then(n=>n===2));
  await wait(()=>liveJoins===1);
  await page.clock.runFor(150);
  await wait(()=>memberListRequests===2);
  await page.clock.fastForward(59000);
  assert.equal(memberListRequests,2,'no periodic refresh before one minute');
  await page.clock.fastForward(1000);
  await wait(()=>memberListRequests===3);
  await wait(()=>page.locator('#admin-refresh').isEnabled());
  assert.match(await page.locator('#member-rows').textContent(),/Telefonas/);
  const coordinates=page.locator('.coordinate-copy');
  assert.equal(await coordinates.innerText(),'54.680123, 25.280456');
  assert.equal(await coordinates.evaluate(element=>getComputedStyle(element).whiteSpace),'nowrap');
  assert.match(await page.locator('.coordinate-state').innerText(),/Paskutinis prašymas: Atmesta programėlėje/);
  assert.match(await page.locator('.coordinate-kind').innerText(),/maža paklaida/);
  const map=page.locator('.coordinate-map');
  assert.equal(new URL(await map.getAttribute('href')).searchParams.get('query'),'54.680123, 25.280456');
  assert.equal(await map.getAttribute('target'),'_blank');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedCoordinate=value;}}}));
  await coordinates.click();
  assert.equal(await page.evaluate(()=>window.copiedCoordinate),'54.680123, 25.280456');
  assert.match(await page.locator('#admin-status').innerText(),/nukopijuotos/);
  const offlineRequest=page.locator('#member-rows tr').filter({hasText:'Atsijungęs'}).getByRole('button',{name:'Vartotojas neprisijungęs',exact:true});
  assert.equal(await offlineRequest.innerText(),'Vartotojas neprisijungęs');
  assert(await offlineRequest.isDisabled());
  locationStatus='browser_denied';
  const requestsBeforeClick=memberListRequests;
  await page.locator('#admin-refresh').click();
  await wait(()=>page.locator('.coordinate-state').innerText().then(text=>text.includes('Atmestas naršyklės leidimas')));
  assert.equal(memberListRequests,requestsBeforeClick+1,'manual refresh runs immediately without waiting for the minute timer');
  locationStatus='pending';
  await page.locator('#admin-refresh').click();
  await wait(()=>page.getByRole('button',{name:'Atšaukti prašymą',exact:true}).count().then(Boolean));
  locationStatus='approved';
  locationAccuracy=35;
  const beforePendingPoll=memberListRequests;
  await page.clock.runFor(2100);
  await wait(()=>page.locator('.exact-location-cell').first().innerText().then(text=>text.includes('±35 m')));
  assert.equal(await page.getByRole('button',{name:'Atšaukti prašymą',exact:true}).count(),0,'an answered request stops waiting even when its broadcast is lost');
  assert.equal(memberListRequests,beforePendingPoll+1,'only pending requests receive a short fallback refresh');
  assert(await page.locator('#admin-refresh').isEnabled(),'fallback updates do not blink or disable the refresh control');
  locationAccuracy=2500;
  locationChanged();
  await page.clock.runFor(150);
  await wait(()=>page.locator('.coordinate-kind').innerText().then(text=>text.includes('apytikslė vieta')));
  assert.match(await page.locator('.exact-location-cell').first().innerText(),/±2500 m/);
  assert(await page.locator('#admin-refresh').isEnabled(),'event updates do not blink or disable the refresh button');
  locationAccuracy=12;
  locationChanged();
  await page.clock.runFor(150);
  await wait(()=>page.locator('.exact-location-cell').first().innerText().then(text=>text.includes('±12 m')));
  locationAccuracy=20;
  liveSocket.close();
  await page.clock.runFor(1300);
  await wait(()=>liveJoins===2);
  await page.clock.runFor(150);
  await wait(()=>page.locator('.exact-location-cell').first().innerText().then(text=>text.includes('±20 m')));
  locationAccuracy=null;
  await page.locator('#admin-refresh').click();
  await wait(()=>page.locator('.coordinate-kind').innerText().then(text=>text.includes('tikslumas nežinomas')));
  assert.match(await page.locator('.exact-location-cell').first().innerText(),/Paklaida nežinoma/);
  disconnectedMember=true;
  locationStatus='pending';
  await page.locator('#admin-refresh').click();
  await wait(()=>disconnectCancellations===1);
  await wait(()=>page.locator('.coordinate-state').innerText().then(text=>text.includes('Atmesta nutrūkus ryšiui')));
  await page.clock.runFor(6500);
  await page.locator('#admin-refresh').click();
  assert.equal(disconnectCancellations,1,'a disconnected request is cancelled once, without automatically resending anything');
  assert.equal(await page.getByRole('button',{name:'Atšaukti prašymą',exact:true}).count(),0);
  const removeMember=()=>page.locator('#member-rows tr').filter({hasText:other}).getByRole('button',{name:'Ištrinti vartotoją',exact:true});
  page.once('dialog',dialog=>dialog.dismiss());
  await removeMember().click();
  assert.equal(deleteAttempts,0,'cancelling confirmation sends no deletion request');
  deleteFails=true;
  page.once('dialog',dialog=>dialog.accept());
  await removeMember().click();
  await wait(()=>deleteAttempts===1);
  await wait(()=>page.locator('#admin-status').innerText().then(text=>text==='Try again'));
  assert.equal(await page.locator('#member-rows tr').count(),2,'failed deletion preserves the member');
  assert(await removeMember().isEnabled(),'failed deletion can be retried manually');
  await page.clock.fastForward(60000);
  locationChanged();
  await page.clock.runFor(150);
  assert.equal(await page.locator('#admin-status').innerText(),'Try again','automatic refresh must not erase the deletion error');
  assert.equal(await page.locator('.admin-delete-error').innerText(),'Try again','failure is visible beside the delete button');
  assert.equal(deleteAttempts,1,'automatic refresh never retries deletion');
  deleteFails=false;
  deleteMissing=true;
  page.once('dialog',dialog=>dialog.accept());
  await removeMember().click();
  await wait(()=>deleteAttempts===2);
  await wait(()=>page.locator('.admin-delete-error').innerText().then(text=>text.includes('admin-delete-member.sql')));
  const migrationLink=page.locator('.admin-delete-error a');
  assert.equal(await migrationLink.getAttribute('href'),'https://github.com/bestfrend/bugnai/blob/master/supabase/admin-delete-member.sql');
  await page.clock.fastForward(60000);
  assert.match(await page.locator('#admin-status').innerText(),/neįdiegtas vartotojų ištrynimas/);
  assert.equal(await page.locator('#member-rows tr').count(),2,'a missing migration does not remove the member from the UI');
  deleteMissing=false;
  page.once('dialog',dialog=>{assert.match(dialog.message(),/visus jo ritmus/);return dialog.accept();});
  await removeMember().click();
  await wait(()=>page.locator('#member-rows tr').count().then(count=>count===1));
  await wait(()=>page.locator('#admin-status').innerText().then(text=>text.includes('ištrintas')));
  assert.equal(deleteAttempts,3);
  assert.match(await page.locator('#member-rows').innerText(),/Ritmas/,'other members remain');
  await page.locator('#admin-refresh').click();
  assert.equal(await page.locator('#member-rows tr').count(),1,'deleted members remain absent after refresh');
  console.log('PASS admin member list');
  await context.close();
}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
    for(const [file,kit] of [['index.html','salamander-v1'],['classic.html','classic-v1'],['studio.html','virtuosity-v1'],['stage.html','stage-v1'],['piano.html','salamander-v1']]){
      await instrumentScenario(browser,file,kit,false);
      await instrumentScenario(browser,file,kit,true);
    }
    await instrumentScenario(browser,'piano.html','salamander-v1',true,true);
    await adminScenario(browser);
  }finally{if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
