/* ─────────────────────────────────────────────────────────────────────────────
   HUM REGRESSION SUITE
   node hum-test.js   — run before shipping ANY scorer or page change.

   Two jobs:
     1. THE ANCHORS. Seven recordings Brixton graded by eye. Twice on 2026-08-18 a
        change that looked obviously right broke one of them (a blanket octave snap
        dropped his perfect hum 100 -> 75). Eyeballing the diff did not catch it;
        this did.
     2. THE JUNK. Everything a stranger's phone will actually hand the scorer -
        silence, noise, one frame, a hum that never resolves. None of it may throw,
        and none of it may return a confident number for something that isn't a hum.
   ───────────────────────────────────────────────────────────────────────────── */
global.window = {};
require('./hum-core.js');
const H = window.HUM;
const fs = require('fs');

let pass = 0, fail = 0;
const ok  = (n, c, d='') => { c ? (pass++, console.log('  ✅ ' + n + (d?'  '+d:'')))
                                : (fail++, console.log('  ❌ ' + n + '  ' + d)); };

function scoreFrames(raw){
  let f = raw.map(x => ({hz: x.hz, clarity: x.clarity !== undefined ? x.clarity : (x.hz?0.85:0.15)}));
  let a=0, z=f.length-1;
  while(a<f.length && !f[a].hz) a++;
  while(z>0 && !f[z].hz) z--;
  if(z-a < 2) { H.setFrames(f); return H.score(); }
  H.setFrames(f.slice(a,z+1));
  const fr = H.getFrames();
  const v = fr.filter(x=>x.hz).map(x=>x.hz);
  if(v.length) H.resolveOctaves(H.confirmNoteOctave(H.robustNote(v)));
  fr.forEach(x=>x.drawHz = x.hz);
  H.deHash();
  return H.score();
}

/* ── 1. THE ANCHORS ──────────────────────────────────────────────────────────
   ⚠️ SUPERSEDED BY audio-test.js FOR ANYTHING ABOUT SCORE ACCURACY.

   These score pre-recorded FRAME data captured from a pipeline that no longer exists.
   The app builds frames from AUDIO, and the two disagree by as much as twelve points -
   SWING23 reads 78.8 here and 66.7 from its own audio; REF3 read 56.6 here while its
   audio read 85.

   That gap is why this suite passed all day on 2026-08-19 while he kept getting bad
   numbers out of the app. It is kept for its INVARIANTS and its JUNK INPUT section, which
   test the scorer's contract and do not depend on the front end. The bands below are
   deliberately loose; when they disagree with audio-test.js, AUDIO WINS. */
console.log('\n── ANCHORS (his own graded recordings) ──');
const anchors = JSON.parse(fs.readFileSync(process.env.ANCHORS || '/tmp/anchors.json'));
const EXPECT = {
  'PERFECT2':  {min: 92, max: 100, cracks: 0, label: 'he said "close to 100"'},
  'REF1':      {min: 92, max: 100, cracks: 0, label: 'he said "high 90s"'},
  'REF2':      {min: 55, max: 75,             label: 'he said below REF-1'},
  'REF3':      {min: 40, max: 75,             label: 'he said "the hum is lost"'},
  'SWING23':   {min: 45, max: 85,             label: 'he said "60s ish" (loose: stale frames, see above)'},
  'SWING63':   {min: 34, max: 62,             label: 'RE-GRADED "50s - lost it at impact"'},
  'SWING121':  {min: 45, max: 78,             label: 'he said "60s ish"'},
};
for(const [k, e] of Object.entries(EXPECT)){
  if(!anchors[k]){ ok(k, false, 'MISSING FIXTURE'); continue; }
  const s = scoreFrames(anchors[k]);
  if(!s){ ok(k, false, 'scored null'); continue; }
  const inRange = s.total >= e.min && s.total <= e.max;
  const crackOk = e.cracks === undefined || s.cracks.length === e.cracks;
  ok(k, inRange && crackOk,
     `${s.total.toFixed(1)} (want ${e.min}-${e.max}) cracks=${s.cracks.length} — ${e.label}`);
}

/* ── 2. INVARIANTS ───────────────────────────────────────────────────────── */
console.log('\n── INVARIANTS ──');
{
  const s = scoreFrames(anchors['REF1']);
  ok('a clean hum is never crack-capped', s.total > H.CRACK_CAP, `${s.total.toFixed(1)}`);
}
{
  // any cracked hum must land below 75 — HIS rule, the one hard promise the UI makes
  let worst = 0, checked = 0;
  for(const k of Object.keys(anchors)){
    const s = scoreFrames(anchors[k]);
    if(s && s.cracks.length){ checked++; worst = Math.max(worst, s.total); }
  }
  ok('every cracked hum scores < 75', worst < 75, `worst=${worst.toFixed(1)} across ${checked}`);
}
{
  const s = scoreFrames(anchors['REF1']);
  ok('score is a finite number', Number.isFinite(s.total), String(s.total));
  ok('no NaN anywhere in the result',
     !JSON.stringify(s).includes('null,') || !Object.values(s).some(v=>typeof v==='number' && !Number.isFinite(v)),
     Object.entries(s).filter(([,v])=>typeof v==='number'&&!Number.isFinite(v)).map(([k])=>k).join(',') || 'clean');
}
{
  // ordering must survive: his perfect hum must outscore his worst swing
  const a = scoreFrames(anchors['PERFECT2']), b = scoreFrames(anchors['SWING63']);
  ok('perfect hum outscores a cracked swing', a.total > b.total,
     `${a.total.toFixed(1)} vs ${b.total.toFixed(1)}`);
}

/* ── 3. JUNK INPUT — a stranger's phone will produce all of this ─────────── */
console.log('\n── JUNK INPUT (must not throw, must not fake a score) ──');
const junk = {
  'empty array':        [],
  'all silence':        Array.from({length:100},()=>({hz:0,clarity:0})),
  'one voiced frame':   [{hz:130,clarity:.9}],
  'two voiced frames':  [{hz:130,clarity:.9},{hz:131,clarity:.9}],
  'pure noise':         Array.from({length:150},()=>({hz:70+Math.random()*330,clarity:0.2})),
  'speech-like':        Array.from({length:150},(_,i)=>({hz:120+80*Math.sin(i/3),clarity:0.5})),
  'alternating on/off': Array.from({length:150},(_,i)=>({hz:i%2?130:0,clarity:i%2?0.8:0})),
  'very long hum':      Array.from({length:2000},()=>({hz:130+Math.random()*2,clarity:0.9})),
  'undefined clarity':  Array.from({length:120},()=>({hz:130})),
  'huge frequencies':   Array.from({length:120},()=>({hz:399,clarity:0.9})),
};
for(const [name, fr] of Object.entries(junk)){
  let s, threw = null;
  try { s = scoreFrames(fr); } catch(e){ threw = e.message; }
  if(threw){ ok(name, false, 'THREW: ' + threw); continue; }
  const finite = !s || (Number.isFinite(s.total) && !Object.values(s)
    .some(v => typeof v === 'number' && !Number.isFinite(v)));
  ok(name, finite, s ? `score ${s.total.toFixed(1)}` : 'null (correctly refused)');
}

/* ── 4. THE WIND GATE ────────────────────────────────────────────────────── */
console.log('\n── THE GATE: always score unless there is no hum ──');
const clean = Array.from({length:150},()=>({hz:130,clarity:0.9}));
ok('a clean hum scores',            H.signalQuality(clean, 0.15).ok);
ok('heavy rumble STILL scores',     H.signalQuality(clean, 0.95).ok, 'noise must not refuse');
ok('low clarity STILL scores',      H.signalQuality(clean.map(f=>({...f,clarity:0.2})), 0.9).ok);
ok('a hum with breath holds scores', H.signalQuality(
     Array.from({length:200},(_,i)=>({hz:(i>60&&i<75)||(i>140&&i<152)?0:130,clarity:0.9})), 0.8).ok);
ok('NO hum is refused',             !H.signalQuality(
     Array.from({length:150},(_,i)=>({hz:i%2?130:0,clarity:0.9})), 0.1).ok,
     'never held a note');

/* ── 5. IMPACT ───────────────────────────────────────────────────────────── */
console.log('\n── IMPACT ──');
{
  const hi = Array.from({length:60},(_,i)=> i===40 ? 5.0 : 0.05 + Math.random()*0.01);
  const im = H.findImpact(hi);
  ok('finds an obvious strike', im && Math.abs(im.frame-40) <= 1, im ? 'frame '+im.frame : 'none');
}
ok('no strike in a flat track', H.findImpact(Array.from({length:60},()=>0.05)) === null);
ok('no strike from too little data', H.findImpact([1,2,3]) === null);
{
  const fr = Array.from({length:60},(_,i)=>({hz: i<40 || i>48 ? 130 : 0, clarity:0.9}));
  const t = H.throughImpact(fr, 40, 400);
  ok('detects a hum that stops at the ball', t && t.restrictedAt === true,
     t ? `after=${t.after.toFixed(2)}` : 'null');
  const fr2 = Array.from({length:60},()=>({hz:130,clarity:0.9}));
  const t2 = H.throughImpact(fr2, 30, 400);
  ok('detects a hum that survives the ball', t2 && t2.survived === true);
}

/* ── 6. THE OCTAVE LOCK ──────────────────────────────────────────────────────
   The bug this suite did NOT catch, and the reason it now exists.

   Brixton hummed one steady note into the board and got two wrong things at once:
   a line "going up and down too much for a pretty steady hum", and no score at all.
   Both came from the same artifact - autocorrelation halving on breathy frames, so
   a hum sitting on D#3 draws deep plunges to D#2 - and both were invisible to a
   suite that only ever fed score() a track someone had already cleaned up.

   The two tests that matter are opposites, and a fix has to pass BOTH: fold the
   artifact, and leave a real hum alone. The blanket snap that was reverted on
   2026-08-18 passed the first and failed the second.                              */
console.log('\n── THE OCTAVE LOCK ──');
{
  const NOTE = 155.6;                                  // D#3, the note he was holding
  // his recording: long flat plateaus with deep one-octave plunges through them
  const halved = Array.from({length:200},(_,i)=>
      (i%17===3 || i%17===4) ? NOTE/2 : NOTE*(1+0.0004*Math.sin(i/3)));
  const ref = H.anchorNote(halved);
  ok('anchors on the NOTE, not the subharmonic',
     ref && Math.abs(1200*Math.log2(ref/NOTE)) < 60, ref ? ref.toFixed(1)+' Hz' : 'none');
  const folded = halved.map(h=>H.foldOctave(h, ref));
  ok('folds every octave plunge back onto the note',
     folded.every(h=>Math.abs(1200*Math.log2(h/NOTE)) < 60),
     folded.filter(h=>Math.abs(1200*Math.log2(h/NOTE))>=60).length + ' left off-note');

  // THE REVERTED-FIX TEST. A real hum must come through completely untouched.
  const real = Array.from({length:200},(_,i)=> NOTE*Math.pow(2,(12*Math.sin(i/9))/1200));
  const refR = H.anchorNote(real);
  ok('a clean hum is not moved at all',
     real.every((h,i)=>H.foldOctave(h,refR) === h), 'no frame touched');

  // a genuine crack is not an octave, so it must survive to be scored and drawn
  const cracked = [...Array(60).fill(NOTE), ...Array(6).fill(NOTE*0.72), ...Array(60).fill(NOTE)];
  const refC = H.anchorNote(cracked);
  ok('a real crack is left alone', cracked.filter((h,i)=>H.foldOctave(h,refC)!==h).length === 0,
     'cracks still visible');

  // and the payoff: the same track scores like the steady hum it actually was
  const asFrames = t => t.map(hz=>({hz, clarity:0.9}));
  H.setFrames(asFrames(halved)); const before = H.score();
  H.setFrames(asFrames(halved.map(h=>H.foldOctave(h, ref)))); const after = H.score();
  ok('a steady hum with octave artifacts now scores as steady',
     after && after.total >= 90 && after.total > before.total,
     `${before ? before.total : 'null'} → ${after ? after.total : 'null'}`);
  ok('and its fake cracks are gone', after && after.cracks.length === 0,
     `${before ? before.cracks.length : '?'} → ${after ? after.cracks.length : '?'} cracks`);
}

/* ── 7. THE SECOND LOOK MUST NEVER DELETE A HUM ──────────────────────────────
   The refusal bug, reduced to the decision that caused it. retrack() returned an
   object for silence too ({hz:0}, which is truthy), and stop() overwrote every live
   frame with it - so a second look that heard nothing erased a hum the live track
   had heard perfectly. The screen then showed a good line above the words "didn't
   hear a hum", because the picture and the message came from different recordings. */
console.log('\n── THE SECOND LOOK ──');
{
  const live = Array.from({length:120},(_,i)=>({hz: i>10 && i<110 ? 155.6 : 0, clarity:0.9}));
  const deaf = Array.from({length:120},()=>null);          // what a wrong-octave pass 2 returns
  const adopt = (cur, re) => {
    const liveOn = cur.filter(f=>f.hz).length;
    const reOn = re ? re.filter(f=>f&&f.hz).length : 0;
    return !!(re && re.length >= cur.length*0.6 && reOn > liveOn);
  };
  ok('a second look that heard LESS is rejected', adopt(live, deaf) === false,
     'live track stands');
  const better = Array.from({length:120},(_,i)=>({hz:155.6, clarity:0.95}));
  ok('a second look that heard MORE is adopted', adopt(live, better) === true,
     'the car-recording fix still works');
  ok('a hum survives a deaf second look',
     scoreFrames(adopt(live, deaf) ? deaf.map(()=>({hz:0})) : live) !== null,
     'still scores');
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}   ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
