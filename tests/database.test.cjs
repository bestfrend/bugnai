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
test('seven slots are a database constraint, not just a UI limit',async()=>{
  await user(alice);
  for(let slot=2;slot<=7;slot++) await insert(alice,slot);
  assert.equal((await db.query('select * from performances where owner_id=$1',[alice])).rows.length,7);
  await assert.rejects(insert(alice,8),{code:'23514'});
  await assert.rejects(insert(alice,0),{code:'23514'});
  await assert.rejects(insert(alice,1),{code:'23505'});
});
test('other users can read but cannot update, delete or take ownership of recordings',async()=>{
  await user(bob);
  assert.equal((await db.query('select * from performances')).rows.length,7);
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
