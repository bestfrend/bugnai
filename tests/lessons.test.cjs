const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const lessons = import('data:text/javascript;base64,'+Buffer.from(readFileSync('lessons.js','utf8')).toString('base64'));

test('melody timing keeps note holds separate from spacing and rests',async()=>{
  const {melody}=await lessons;
  const result=melody(['c4',['d4',2,1.5],[null,.5],['e4',.5,.4],[null,1]]);
  assert.deepEqual(result,{events:[
    {key:'c4',beat:0,duration:.8},
    {key:'d4',beat:1,duration:1.5},
    {key:'e4',beat:3.5,duration:.4}
  ],durationBeats:5});
  for(const input of [[],[[null,1]],[['c4',0]],[['c4',-1]],[['c4',1,2]],[['c4',1,0]],[['bad',1]],[['c4',NaN]]]){
    assert.throws(()=>melody(input),TypeError,'new melodies must satisfy the timing standard');
  }
});

test('all piano lessons have written holds, varied rhythm and a complete closing rest',async()=>{
  const {lessonsForKit,lessonSpeeds}=await lessons;
  const definitions=lessonsForKit('salamander-v1');
  assert.equal(definitions.length,6);
  assert.deepEqual(definitions.filter(song=>song.level===1).map(song=>song.durationBeats),[32,32,32,48]);
  for(const song of definitions){
    assert(new Set(song.events.map(note=>note.duration)).size>1,song.id+' has different note lengths');
    for(const [index,note] of song.events.entries()){
      const next=song.events[index+1]?.beat??song.durationBeats;
      assert(note.duration>0&&note.beat+note.duration<=next,song.id+' never holds through a written rest or the next note');
    }
    const last=song.events.at(-1);
    assert(song.durationBeats-last.beat-last.duration>=.5,song.id+' keeps a closing breath before repeating');
    for(const speed of lessonSpeeds){
      assert(last.beat*speed.beatMs+last.duration*speed.beatMs<song.durationBeats*speed.beatMs);
    }
  }
  const ode=definitions[0];
  assert.equal(ode.events[12].beat,12);
  assert.equal(ode.events[13].beat,13.5,'Ode to Joy uses a dotted quarter followed by an eighth');
  assert.equal(ode.events[15].beat,16,'the second phrase begins on its bar boundary');
  assert.equal(definitions[2].events.at(-1).duration,3.4,'Mary ends on a sustained tonic');
});


test('three unequal lesson levels contain playable public-domain themes with stable per-song tempos',async()=>{
  const {lessonsForKit,lessonSpeeds,pianoLessonLevels,tempoForLesson}=await lessons;
  const definitions=lessonsForKit('salamander-v1');
  assert.deepEqual(pianoLessonLevels.map(level=>level.id),[1,2,3]);
  assert.deepEqual(pianoLessonLevels.map(level=>definitions.filter(song=>song.level===level.id).length),[4,1,1]);
  const minuet=definitions.find(song=>song.id==='minuet-in-g');
  const elise=definitions.find(song=>song.id==='fur-elise-theme');
  assert.equal(minuet.composer,'Christian Petzold');
  assert.equal(minuet.durationBeats,48,'sixteen bars of three beats');
  assert.equal(elise.durationBeats,24.5,'the opening theme repeats and then leaves a breath');
  assert.deepEqual(elise.events.slice(0,5).map(note=>note.key),['e5','ds5','e5','ds5','e5']);
  assert(minuet.events.some(note=>note.key==='fs5'));
  assert(elise.events.some(note=>note.key==='gs4'));
  for(const song of [minuet,elise]){
    assert(song.events.length>50,'the new level teaches a complete longer phrase');
    assert(song.source.startsWith('https://github.com/MutopiaProject/'));
    const normal=tempoForLesson(song,lessonSpeeds[1]);
    assert.equal(normal.beatMs,60000/song.bpm);
    assert.deepEqual(tempoForLesson(song,normal),normal,'repeating does not rescale the song twice');
    assert(tempoForLesson(song,lessonSpeeds[0]).beatMs>normal.beatMs);
    assert(tempoForLesson(song,lessonSpeeds[2]).beatMs<normal.beatMs);
  }
  assert.deepEqual(tempoForLesson(definitions[0],lessonSpeeds[0]),lessonSpeeds[0]);
  assert.equal(lessonsForKit('stage-v1').length,4,'drum lessons are not split into piano levels');
});
