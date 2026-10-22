const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
let db;
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const notes = JSON.stringify([{key:'w',time:0},{key:'k',time:250}]);
async function user(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec('set role authenticated');
}
async function insert(owner, slot, events = notes, duration = 250) {
  return db.query('insert into public.performances(owner_id,slot,events,duration_ms) values ($1,$2,$3,$4)', [owner,slot,events,duration]);
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ('${alice}'), ('${bob}');`);
  const schema = readFileSync('supabase/schema.sql','utf8');
  await db.exec(schema);
  await db.exec(schema);
  // Existing installations need only the additive avatar migration.
  await db.exec('alter table public.profiles drop column avatar_data');
  const avatars = readFileSync('supabase/avatars.sql', 'utf8');
  await db.exec(avatars);
  await db.exec(avatars);
  await db.exec('alter table public.performances drop constraint performances_slot_check; alter table public.performances add constraint performances_slot_check check(slot between 1 and 7); alter table public.performances drop column title');
  const rhythms = readFileSync('supabase/recordings-50.sql', 'utf8');
  await db.exec(rhythms);
  await db.exec(rhythms);
  await user(alice);
  await db.query('insert into profiles(id,nickname) values ($1,$2)',[alice,'Pirmas']);
  await user(bob);
  await db.query('insert into profiles(id,nickname) values ($1,$2)',[bob,'Antras']);
});
after(async()=>{ await db.close(); });
test('avatars are readable by signed-in users but writable only by their owner',async()=>{
  const avatar='data:image/jpeg;base64,/9j/2Q==';
  await user(alice);
  await db.query('update profiles set avatar_data=$1 where id=$2',[avatar,alice]);
  await user(bob);
  assert.equal((await db.query('select avatar_data from profiles where id=$1',[alice])).rows[0].avatar_data,avatar);
  assert.equal((await db.query('update profiles set avatar_data=null where id=$1 returning id',[alice])).rows.length,0);
  await assert.rejects(db.query('update profiles set nickname=$1 where id=$2',['Other',bob]),{code:'42501'});
  await user(alice);
  await assert.rejects(db.query('update profiles set avatar_data=$1 where id=$2',['data:image/svg+xml;base64,PHN2Zz4=',alice]),{code:'23514'});
  await assert.rejects(db.query('update profiles set avatar_data=$1 where id=$2',['data:image/jpeg;base64,'+'A'.repeat(32768),alice]),{code:'23514'});
  await db.query('update profiles set avatar_data=null where id=$1',[alice]);
});
test('authenticated visitors see all profiles; unauthenticated visitors cannot read or write',async()=>{
  await user(alice);
  assert.equal((await db.query('select * from profiles')).rows.length,2);
  await db.exec('reset role; set role anon');
  for(const table of ['profiles','performances']) {
    await assert.rejects(db.query(`select * from ${table}`),{code:'42501'});
  }
  await assert.rejects(insert(alice,1),{code:'42501'});
});
test('only an owner can create their profile or performance',async()=>{
  await user(alice);
  await assert.rejects(db.query('insert into profiles(id,nickname) values ($1,$2)',[bob,'Impostor']),{code:'42501'});
  await assert.rejects(insert(bob,1),{code:'42501'});
  await insert(alice,1);
});
test('fifty rhythms are a database constraint, not just a UI limit',async()=>{
  await user(alice);
  for(let slot=2;slot<=50;slot++) await insert(alice,slot);
  assert.equal((await db.query('select * from performances where owner_id=$1',[alice])).rows.length,50);
  await assert.rejects(insert(alice,51),{code:'23514'});
  await assert.rejects(insert(alice,0),{code:'23514'});
  await assert.rejects(insert(alice,1),{code:'23505'});
});
test('other users can read but cannot update, delete or take ownership of recordings',async()=>{
  await user(bob);
  assert.equal((await db.query('select * from performances')).rows.length,50);
  const changed=await db.query('update performances set duration_ms=250 where owner_id=$1 returning *',[alice]);
  assert.equal(changed.rows.length,0);
  const removed=await db.query('delete from performances where owner_id=$1 returning *',[alice]);
  assert.equal(removed.rows.length,0);
  await user(alice);
  await assert.rejects(db.query('update performances set owner_id=$1 where owner_id=$2 and slot=1',[bob,alice]),{code:'42501'});
});
test('owners can overwrite and delete their own slots without affecting other users',async()=>{
  await user(bob);
  await insert(bob,1);
  await user(alice);
  const replacement=JSON.stringify([{key:'l',time:0}]);
  await db.query('insert into performances(owner_id,slot,events,duration_ms) values($1,1,$2,0) on conflict(owner_id,slot) do update set events=excluded.events,duration_ms=excluded.duration_ms',[alice,replacement]);
  const data=(await db.query('select * from performances where owner_id=$1 and slot=1',[alice])).rows[0];
  assert.equal(data.events[0].key,'l');
  assert.equal(data.duration_ms,0);
  await db.query('delete from performances where owner_id=$1 and slot=1',[alice]);
  assert.equal((await db.query('select * from performances where owner_id=$1',[bob])).rows.length,1);
});
test('malformed, oversized and unsorted recordings are rejected',async()=>{
  await user(alice);
  const invalid = [
    [[],0], [[{key:'x',time:0}],0], [[{key:'w',time:1}],1],
    [[{key:'w',time:0},{key:'w',time:120001}],120000],
    [[{key:'w',time:0},{key:'k',time:20},{key:'a',time:10}],10],
    [[{key:'w',time:0.5}],0], [[{key:'w',time:0}],10],
    [[{key:'w',time:'0'}],0], [[{key:'w'}],0],
    [[{time:0}],0], [[{key:'w',time:0,extra:true}],0],
    [Array.from({length:6001},()=>({key:'w',time:0})),0]
  ];
  for(const [events,ms] of invalid) await assert.rejects(insert(alice,1,JSON.stringify(events),ms),{code:'23514'});
  await insert(alice,1,JSON.stringify([{key:'w',time:0},{key:'k',time:360000}]),360000);
});
test('rhythm titles are editable only by their owner and migration preserves existing data',async()=>{
  await user(alice);
  const before = (await db.query('select events from performances where owner_id=$1 and slot=1',[alice])).rows[0].events;
  await db.query('update performances set title=$1 where owner_id=$2 and slot=1',['Mano ritmas',alice]);
  await assert.rejects(db.query('update performances set title=$1 where owner_id=$2 and slot=1',['x'.repeat(61),alice]),{code:'23514'});
  await assert.rejects(db.query('update performances set title=$1 where owner_id=$2 and slot=1',[' tarpai ',alice]),{code:'23514'});
  await user(bob);
  assert.equal((await db.query('select title from performances where owner_id=$1 and slot=1',[alice])).rows[0].title,'Mano ritmas');
  assert.equal((await db.query('update performances set title=$1 where owner_id=$2 returning *',['Svetimas',alice])).rows.length,0);
  await db.exec('reset role');
  await db.exec(readFileSync('supabase/recordings-50.sql','utf8'));
  assert.deepEqual((await db.query('select events from performances where owner_id=$1 and slot=1',[alice])).rows[0].events,before);
  assert.equal((await db.query('select title from performances where owner_id=$1 and slot=1',[alice])).rows[0].title,'Mano ritmas');
});
test('creation dates are backfilled from known timestamps and immutable after creation',async()=>{
  await db.exec('reset role');
  const old=(await db.query('select updated_at from performances where owner_id=$1 and slot=1',[alice])).rows[0].updated_at;
  // Reproduce the deployed schema that only knew updated_at.
  await db.exec(`create or replace function public.stamp_performance()
    returns trigger language plpgsql set search_path = '' as $$
    begin new.updated_at := now(); return new; end; $$;
    alter table public.performances drop column created_at;`);
  await db.exec(readFileSync('supabase/creation-date.sql','utf8'));
  await db.exec(readFileSync('supabase/creation-date.sql','utf8'));
  await user(alice);
  assert.deepEqual((await db.query('select created_at from performances where owner_id=$1 and slot=1',[alice])).rows[0].created_at,old);
  assert.deepEqual((await db.query('select updated_at from performances where owner_id=$1 and slot=1',[alice])).rows[0].updated_at,old,'migration does not change the last modification timestamp');
  await db.query("update performances set title='Kitas vardas', created_at='2000-01-01' where owner_id=$1 and slot=1",[alice]);
  assert.deepEqual((await db.query('select created_at from performances where owner_id=$1 and slot=1',[alice])).rows[0].created_at,old);
  await user(bob);
  await db.query("insert into performances(owner_id,slot,events,duration_ms,created_at) values($1,2,$2,250,'2000-01-01')",[bob,notes]);
  const created=(await db.query('select created_at from performances where owner_id=$1 and slot=2',[bob])).rows[0].created_at;
  assert.notEqual(new Date(created).getUTCFullYear(),2000,'the database stamps new records itself');
});
test('versioned kits and optional integer velocities preserve legacy recordings',async()=>{
  await db.exec('reset role; alter table performances drop column kit');
  const migration=readFileSync('supabase/drum-kits.sql','utf8');
  await db.exec(migration);
  await db.exec(migration);
  await user(alice);
  assert.equal((await db.query('select kit from performances where owner_id=$1 and slot=1',[alice])).rows[0].kit,'classic-v1');
  await user(bob);
  const events=JSON.stringify([{key:'w',time:0,velocity:20},{key:'j',time:100,velocity:96},{key:'k',time:200,velocity:127}]);
  await db.query('insert into performances(owner_id,slot,events,duration_ms,kit) values($1,3,$2,200,$3)',[bob,events,'virtuosity-v1']);
  for(const velocity of [0,128,1.5,'96',null]) {
    await assert.rejects(insert(bob,4,JSON.stringify([{key:'w',time:0,velocity}]),0),{code:'23514'});
  }
  await assert.rejects(db.query('insert into performances(owner_id,slot,events,duration_ms,kit) values($1,4,$2,250,$3)',[bob,notes,'unknown-v2']),{code:'23514'});
  await user(alice);
  const saved=(await db.query('select * from performances where owner_id=$1 and slot=3',[bob])).rows[0];
  assert.equal(saved.kit,'virtuosity-v1');
  assert.equal(saved.events[1].velocity,96);
  assert.equal((await db.query("update performances set kit='classic-v1' where owner_id=$1 returning *",[bob])).rows.length,0);
});
test('piano migration preserves drums, validates held chords and keeps owner permissions',async()=>{
  await db.exec('reset role');
  const before=(await db.query('select events from performances where owner_id=$1 and slot=3',[bob])).rows[0].events;
  const migration=readFileSync('supabase/piano.sql','utf8');
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await db.query('select events from performances where owner_id=$1 and slot=3',[bob])).rows[0].events,before);
  await user(bob);
  const chord=[{key:'c4',time:0,velocity:96,length:900},{key:'cs4',time:100,velocity:70,length:200},{key:'c5',time:200,velocity:127,length:300}];
  const save=(events,duration=900,kit='salamander-v1')=>db.query('insert into performances(owner_id,slot,events,duration_ms,kit) values($1,4,$2,$3,$4)',[bob,JSON.stringify(events),duration,kit]);
  const invalid=[
    [chord,500], [chord,900,'classic-v1'], [JSON.parse(notes),250,'salamander-v1'],
    [[{...chord[0],length:-1}]], [[{...chord[0],length:1.5}]], [[{...chord[0],length:120001}]],
    [[{...chord[0],key:'c9'}]], [[{...chord[0],velocity:128}]],
    [[{key:'c4',time:0,velocity:96}]], [[{...chord[0],extra:true}]],
    [[chord[0],{key:'w',time:100,velocity:96}]], [[{key:'w',time:0,length:900}]]
  ];
  for(const args of invalid)await assert.rejects(save(...args),{code:'23514'});
  await save(chord);
  await user(alice);
  const saved=(await db.query('select * from performances where owner_id=$1 and slot=4',[bob])).rows[0];
  assert.deepEqual(saved.events,chord);
  assert.equal(saved.duration_ms,900,'a chord lasts until its final key release');
  assert.equal((await db.query('delete from performances where owner_id=$1 and slot=4 returning *',[bob])).rows.length,0);
  await user(bob);
  await db.query("update performances set title='Pianino akordas' where owner_id=$1 and slot=4",[bob]);
});
test('piano octave migration accepts C2 through C7 and preserves the original octave',async()=>{
  await db.exec('reset role');
  const migration=readFileSync('supabase/piano-octaves.sql','utf8');
  await db.exec(migration);
  await db.exec(migration);
  await user(bob);
  const lowAndHigh=[{key:'c2',time:0,velocity:80,length:180},{key:'as6',time:220,velocity:100,length:180},{key:'c7',time:440,velocity:127,length:180}];
  await db.query('insert into performances(owner_id,slot,events,duration_ms,kit) values($1,5,$2,620,$3)',[bob,JSON.stringify(lowAndHigh),'salamander-v1']);
  const invalid=[
    [{key:'b1',time:0,velocity:96,length:10}],
    [{key:'cs7',time:0,velocity:96,length:10}],
    [{key:'c8',time:0,velocity:96,length:10}],
    [{key:'h4',time:0,velocity:96,length:10}]
  ];
  for(const events of invalid) await assert.rejects(db.query('insert into performances(owner_id,slot,events,duration_ms,kit) values($1,6,$2,10,$3)',[bob,JSON.stringify(events),'salamander-v1']),{code:'23514'});
  await user(alice);
  const saved=(await db.query('select events from performances where owner_id=$1 and slot=5',[bob])).rows[0].events;
  assert.deepEqual(saved,lowAndHigh);
});
test('visual stage kit accepts its own saved recordings and preserves existing kits',async()=>{
  await db.exec('reset role');
  const migration=readFileSync('supabase/visual-stage-kit.sql','utf8');
  await db.exec(migration);
  await db.exec(migration);
  await user(bob);
  const visualEvents=[{key:'s',time:0,velocity:70},{key:'j',time:80,velocity:96},{key:'l',time:120,velocity:127}];
  await db.query('insert into performances(owner_id,slot,events,duration_ms,kit) values($1,8,$2,120,$3)',[bob,JSON.stringify(visualEvents),'stage-v1']);
  assert.deepEqual((await db.query('select events,kit from performances where owner_id=$1 and slot=8',[bob])).rows[0],{events:visualEvents,kit:'stage-v1'});
  await assert.rejects(db.query("update performances set kit='unknown-stage' where owner_id=$1 and slot=8",[bob]),{code:'23514'});
});
test('recordings can exceed two minutes while preserving note validation and ownership',async()=>{
  await db.exec('reset role');
  const before=(await db.query('select events from performances where owner_id=$1 and slot=5',[bob])).rows[0].events;
  const migration=readFileSync('supabase/recordings-no-time-limit.sql','utf8');
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await db.query('select events from performances where owner_id=$1 and slot=5',[bob])).rows[0].events,before);
  await user(bob);
  await insert(bob,6,JSON.stringify([{key:'w',time:0},{key:'l',time:360000}]),360000);
  const piano=[{key:'c4',time:0,velocity:96,length:140000},{key:'c7',time:140500,velocity:96,length:200000}];
  await db.query('insert into performances(owner_id,slot,events,duration_ms,kit) values($1,7,$2,340500,$3)',[bob,JSON.stringify(piano),'salamander-v1']);
  await assert.rejects(db.query('update performances set duration_ms=340499 where owner_id=$1 and slot=7',[bob]),{code:'23514'});
  await assert.rejects(insert(bob,8,JSON.stringify(Array.from({length:6001},()=>({key:'w',time:0}))),0),{code:'23514'});
  await user(alice);
  assert.equal((await db.query('update performances set duration_ms=340500 where owner_id=$1 and slot=7 returning *',[bob])).rows.length,0);
  assert.equal((await db.query('select duration_ms from performances where owner_id=$1 and slot=7',[bob])).rows[0].duration_ms,340500);
});
test('private device data and consent-based location requests are admin-only',async()=>{
  await db.exec(`reset role;
    create schema if not exists extensions;
    create or replace function extensions.crypt(value text, salt text) returns text language sql immutable as $$ select value $$;`);
  const migration=readFileSync('supabase/member-insights.sql','utf8')
    .replace('create extension if not exists pgcrypto with schema extensions;','');
  await db.exec(migration);
  await db.exec(migration);
  await db.query("insert into admin_secrets values(true,'test-admin-code')");
  await user(alice);
  await db.query("select start_member_session('Telefonas','Android','Chrome','Vilnius, Lietuva')");
  await assert.rejects(db.query('select * from member_presence'),{code:'42501'});
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query("select * from admin_list_members('blogas')"),{code:'42501'});
  const members=(await db.query("select * from admin_list_members('test-admin-code')")).rows;
  assert.equal(members.find(member=>member.id===alice).device_type,'Telefonas');
  const request=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  await user(bob);
  assert.equal((await db.query('select * from member_pending_location_request()')).rows.length,0);
  await assert.rejects(db.query("select member_respond_location_request($1,'approved',54.68,25.28,10)",[request]),{code:'P0002'});
  await user(alice);
  assert.equal((await db.query('select * from member_pending_location_request()')).rows[0].id,request);
  await db.query("select member_respond_location_request($1,'approved',54.68,25.28,10)",[request]);
  await db.exec('reset role; set role anon');
  const updated=(await db.query("select * from admin_list_members('test-admin-code') where id=$1",[alice])).rows[0];
  assert.equal(updated.location_status,'approved');
  assert.equal(updated.exact_latitude,54.68);
  const historyMigration=readFileSync('supabase/location-history.sql','utf8');
  await db.exec('reset role');
  await db.exec(historyMigration);
  await db.exec(historyMigration);
  await db.exec('set role anon');
  const declinedRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  const pending=(await db.query("select * from admin_list_members('test-admin-code') where id=$1",[alice])).rows[0];
  assert.equal(pending.location_status,'pending');
  assert.equal(pending.exact_latitude,54.68,'pending request keeps the previous approved location');
  await user(alice);
  await db.query("select member_respond_location_request($1,'declined')",[declinedRequest]);
  await db.exec('reset role; set role anon');
  const declined=(await db.query("select * from admin_list_members('test-admin-code') where id=$1",[alice])).rows[0];
  assert.equal(declined.location_status,'declined');
  assert.equal(declined.exact_latitude,54.68,'declining a new request does not hide saved coordinates');
  assert.equal(declined.exact_longitude,25.28);
  const newerRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  await user(alice);
  await db.query("select member_respond_location_request($1,'approved',55.1,24.9,5)",[newerRequest]);
  await db.exec('reset role; set role anon');
  const newest=(await db.query("select * from admin_list_members('test-admin-code') where id=$1",[alice])).rows[0];
  assert.equal(newest.exact_latitude,55.1,'a later approval replaces the displayed location');
  const expiryMigration=readFileSync('supabase/location-request-expiry.sql','utf8');
  await db.exec('reset role');
  await db.exec(expiryMigration);
  await db.exec(expiryMigration);
  await db.exec('set role anon');
  await assert.rejects(db.query("select admin_request_location('test-admin-code',$1)",[bob]),{code:'P0002'});
  const timedRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  const timed=(await db.query("select * from admin_list_members('test-admin-code') where id=$1",[alice])).rows[0];
  assert.equal(timed.location_status,'pending');
  assert(Date.parse(timed.location_expires_at) - Date.parse(timed.location_requested_at) <= 10_000);
  await db.query("select admin_cancel_location_request('test-admin-code',$1)",[alice]);
  const cancelled=(await db.query("select * from admin_list_members('test-admin-code') where id=$1",[alice])).rows[0];
  assert.equal(cancelled.location_status,'expired');
  assert.equal(cancelled.exact_latitude,55.1,'cancelling keeps the previous approved location');
  await db.exec('reset role');
  const permissionMigration=readFileSync('supabase/location-permission-status.sql','utf8');
  await db.exec(permissionMigration);
  await db.exec(permissionMigration);
  await db.exec('set role anon');
  const browserRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  await user(alice);
  await db.query("select member_respond_location_request($1,'browser_denied')",[browserRequest]);
  await db.exec('reset role; set role anon');
  const denied=(await db.query("select * from admin_list_members('test-admin-code') where id=$1",[alice])).rows[0];
  assert.equal(denied.location_status,'browser_denied','browser permission refusal is distinct from in-app refusal');
  assert.equal(denied.exact_latitude,55.1,'browser refusal preserves the last approved location');
  const expiredRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  await db.exec('reset role');
  await db.query("update location_requests set expires_at=now()-interval '1 second' where id=$1",[expiredRequest]);
  await user(alice);
  assert.equal((await db.query('select * from member_pending_location_request()')).rows.length,0);
  await assert.rejects(db.query("select member_respond_location_request($1,'approved',54.68,25.28,10)",[expiredRequest]),{code:'P0002'});
  await db.exec('reset role');
  const noTimeoutMigration=readFileSync('supabase/location-no-timeout.sql','utf8');
  await db.exec(noTimeoutMigration);
  await db.exec(noTimeoutMigration);
  await db.query("update location_requests set requested_at=now()-interval '3 minutes' where member_id=$1",[alice]);
  await db.exec('set role anon');
  const lastingRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  await db.exec('reset role');
  await db.query("update location_requests set requested_at=now()-interval '2 minutes' where id=$1",[lastingRequest]);
  await user(alice);
  const lasting=(await db.query('select * from member_pending_location_request()')).rows[0];
  assert.equal(lasting.id,lastingRequest,'requests stay available after the previous time limit');
  assert.equal(lasting.expires_at,null);
  await db.query("select member_respond_location_request($1,'approved',55.2,24.8,5)",[lastingRequest]);
  await db.exec('reset role; set role anon');
  const cancelledRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  await db.query("select admin_cancel_location_request('test-admin-code',$1)",[alice]);
  await user(alice);
  await assert.rejects(db.query("select member_respond_location_request($1,'approved',56,24,5)",[cancelledRequest]),{code:'P0002'});
  await db.exec('reset role; set role anon');
  const preserved=(await db.query("select * from admin_list_members('test-admin-code') where id=$1",[alice])).rows[0];
  assert.equal(preserved.exact_latitude,55.2,'late approval after admin cancellation cannot change coordinates');
  const begunRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  await user(bob);
  await assert.rejects(db.query('select member_begin_location_request($1)',[begunRequest]),{code:'P0002'});
  await user(alice);
  await db.query('select member_begin_location_request($1)',[begunRequest]);
  await db.exec('reset role; set role anon');
  await db.query("select admin_cancel_location_request('test-admin-code',$1)",[alice]);
  const moreRecentRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  await user(alice);
  await db.query("select member_respond_location_request($1,'approved',54,25,1500)",[moreRecentRequest]);
  await user(alice);
  await db.query("select member_respond_location_request($1,'approved',55.3,24.7,5)",[begunRequest]);
  await db.exec('reset role; set role anon');
  const completed=(await db.query("select * from admin_list_members('test-admin-code') where id=$1",[alice])).rows[0];
  assert.equal(completed.exact_latitude,55.3,'an already-started browser approval can finish after admin cancellation');
  assert.equal(completed.exact_accuracy_m,5,'the latest received precise result replaces a previously received approximate result');
  await db.exec(`reset role;
    create schema if not exists realtime;
    create table realtime.test_notifications (payload jsonb, event_name text, topic text, is_private boolean);
    create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$
      insert into realtime.test_notifications values ($1,$2,$3,$4)
    $$;`);
  const liveMigration=readFileSync('supabase/location-live-updates.sql','utf8');
  await db.exec(liveMigration);
  await db.exec(liveMigration);
  await user(bob);
  await db.query('select member_refine_location_request($1,56,24,1)',[moreRecentRequest]);
  await user(alice);
  await db.query('select member_refine_location_request($1,54.1,25.1,20)',[moreRecentRequest]);
  await db.query('select member_refine_location_request($1,54.2,25.2,2000)',[moreRecentRequest]);
  await db.exec('reset role');
  const refined=(await db.query('select * from location_requests where id=$1',[moreRecentRequest])).rows[0];
  assert.equal(refined.latitude,54.1,'only the owner can refine a consented fix, and worse results are ignored');
  assert.equal(refined.accuracy_m,20);
  await db.query("update location_requests set responded_at=now()-interval '1 minute' where id=$1",[moreRecentRequest]);
  await user(alice);
  await db.query('select member_refine_location_request($1,56,24,1)',[moreRecentRequest]);
  await db.exec('reset role');
  assert.equal((await db.query('select accuracy_m from location_requests where id=$1',[moreRecentRequest])).rows[0].accuracy_m,20,'refinement cannot keep tracking after the acquisition window');
  await db.exec('set role anon');
  const liveRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  await user(alice);
  await db.query('select member_begin_location_request($1)',[liveRequest]);
  await db.query("select member_respond_location_request($1,'declined')",[liveRequest]);
  await db.exec('reset role');
  const notifications=(await db.query('select * from realtime.test_notifications')).rows;
  assert(notifications.length>=3,'request creation, consent start and response each notify the admin');
  for(const notification of notifications){
    assert.deepEqual(notification.payload,{},'notifications contain no member or location data');
    assert.equal(notification.event_name,'location_changed');
    assert.equal(notification.topic,'admin-location-updates');
    assert.equal(notification.is_private,false);
  }
  await db.exec(`create or replace function realtime.send(jsonb,text,text,boolean) returns void language plpgsql as $$
    begin raise exception 'Notification service unavailable'; end;
  $$; set role anon;`);
  const outageRequest=(await db.query("select admin_request_location('test-admin-code',$1) as id",[alice])).rows[0].id;
  await user(alice);
  await db.query("select member_respond_location_request($1,'approved',55.4,24.6,8)",[outageRequest]);
  await db.exec('reset role; set role anon');
  const duringOutage=(await db.query("select * from admin_list_members('test-admin-code') where id=$1",[alice])).rows[0];
  assert.equal(duringOutage.exact_latitude,55.4,'notification failure must not prevent saving consented coordinates');
});

test('only the administrator can delete an account and its data, preserving other members',async()=>{
  const removed='33333333-3333-4333-8333-333333333333';
  await db.exec('reset role');
  const migration=readFileSync('supabase/admin-delete-member.sql','utf8');
  await db.exec(migration);
  await db.exec(migration);
  await db.query('insert into auth.users values($1)',[removed]);
  await user(removed);
  await db.query('insert into profiles(id,nickname,avatar_data) values($1,$2,$3)',[removed,'Ištrinamas','data:image/jpeg;base64,/9j/2Q==']);
  await insert(removed,1);
  await db.query("select start_member_session('Telefonas','Android','Chrome','Vilnius')");
  await db.exec('reset role; set role anon');
  await db.query("select admin_request_location('test-admin-code',$1)",[removed]);
  for(const role of ['anon','authenticated']){
    await db.exec('reset role; set role '+role);
    for(const code of [null,'','wrong'])await assert.rejects(db.query('select admin_delete_member($1,$2)',[code,removed]),{code:'42501'});
    await assert.rejects(db.query('delete from auth.users where id=$1',[removed]),{code:'42501'});
  }
  await db.exec('reset role');
  for(const [table,key] of [['auth.users','id'],['public.profiles','id'],['public.performances','owner_id'],['public.member_presence','member_id'],['public.location_requests','member_id']]){
    assert.equal((await db.query(`select count(*)::int as n from ${table} where ${key}=$1`,[removed])).rows[0].n,1);
  }
  const before=(await db.query('select id from profiles where id<>$1 order by id',[removed])).rows;
  await db.exec('set role anon');
  await db.query("select admin_delete_member('test-admin-code',$1)",[removed]);
  await assert.rejects(db.query("select admin_delete_member('test-admin-code',$1)",[removed]),{code:'P0002'});
  await db.exec('reset role');
  for(const [table,key] of [['auth.users','id'],['public.profiles','id'],['public.performances','owner_id'],['public.member_presence','member_id'],['public.location_requests','member_id']]){
    assert.equal((await db.query(`select count(*)::int as n from ${table} where ${key}=$1`,[removed])).rows[0].n,0);
  }
  assert.deepEqual((await db.query('select id from profiles order by id')).rows,before);
});
