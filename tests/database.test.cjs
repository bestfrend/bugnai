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
test('malformed, oversized, unsorted and over-two-minute recordings are rejected',async()=>{
  await user(alice);
  const invalid = [
    [[],0], [[{key:'x',time:0}],0], [[{key:'w',time:1}],1],
    [[{key:'w',time:0},{key:'w',time:120001}],120001],
    [[{key:'w',time:0},{key:'k',time:20},{key:'a',time:10}],10],
    [[{key:'w',time:0.5}],0], [[{key:'w',time:0}],10],
    [[{key:'w',time:'0'}],0], [[{key:'w'}],0],
    [[{time:0}],0], [[{key:'w',time:0,extra:true}],0],
    [Array.from({length:6001},()=>({key:'w',time:0})),0]
  ];
  for(const [events,ms] of invalid) await assert.rejects(insert(alice,1,JSON.stringify(events),ms),{code:'23514'});
  await insert(alice,1,JSON.stringify([{key:'w',time:0},{key:'k',time:120000}]),120000);
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
});
