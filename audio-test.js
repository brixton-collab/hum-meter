/* ─────────────────────────────────────────────────────────────────────────────
   THE AUDIO SUITE.   node audio-test.js

   ⚠️ THIS REPLACES hum-test.js AS THE AUTHORITY ON WHETHER THE APP IS RIGHT.

   hum-test.js scores pre-recorded FRAME data out of anchors.json. The app derives frames
   from AUDIO, through a pipeline that has changed enormously - a live filter, a second
   look, an octave fold, an on-note gate. The two now disagree badly: REF3 reads 56.6 from
   stored frames and 69 from its own audio, SWING121 reads 67.9 and 82.

   That gap is why the anchor suite kept passing all day while he kept getting bad numbers.
   Every tuning decision was being judged against a snapshot of a pipeline that no longer
   exists. This suite runs his ACTUAL RECORDINGS through the ACTUAL pipeline and checks
   the answer against what HE said, which is the only ground truth in the project.
   ───────────────────────────────────────────────────────────────────────────── */
global.window={}; require('./hum-core.js'); const H=window.HUM;
const {wav,pageBits}=require('./noise-lib.js'); const P=pageBits(H);
const fs=require('fs');

/* the shipping pipeline, end to end from audio - kept in step with hum-board.html */
function pipeline(pcm, sr){
  const step=Math.round(sr*H.HOP/1000), W=2048;
  const band=P.wideBand(pcm,sr); const fr=[], lvl=[];
  for(let i=0;i+W<=band.length;i+=step){
    const d=H.detect(Float32Array.from(band.subarray(i,i+W)),sr,H.SR_MIN,H.CLARITY_FILTERED);
    fr.push({hz:d?d.hz:0, clarity:d?d.clarity:0});
    let e=0; for(let k=i;k<i+W;k++) e+=band[k]*band[k];
    lvl.push(Math.sqrt(e/W));
  }
  const live=fr.map(f=>f.hz);
  try{
    const re=P.retrack(pcm,sr,H.HOP,W);
    const lo=live.filter(Boolean).length, ro=re?re.filter(f=>f&&f.hz).length:0;
    if(re && re.length>=fr.length*0.6 && ro>lo)
      for(let i=0;i<fr.length;i++){ const r=re[Math.min(i,re.length-1)];
        fr[i].hz=r?r.hz:0; fr[i].clarity=r?r.clarity:0; }
  }catch(e){}
  { let on=0; for(const f of fr) if(f.hz) on++;
    if(on<10) for(let i=0;i<fr.length;i++) fr[i].hz=live[i]; }
  let a=0,z=fr.length-1;
  while(a<fr.length&&!fr[a].hz)a++; while(z>0&&!fr[z].hz)z--;
  if(z-a<10) return null;
  const F=fr.slice(a,z+1), L=lvl.slice(a,z+1);
  H.setFrames(F);
  const q=H.signalQuality(F, 0);
  if(!q.ok) return {refused:q.fails.join('+')};
  const v=F.filter(f=>f.hz).map(f=>f.hz);
  if(v.length) H.resolveOctaves(H.confirmNoteOctave(H.robustNote(v)));
  const ref=H.anchorNote(F.filter(f=>f.hz).map(f=>f.hz));
  if(ref){ F.forEach(f=>{if(f.hz)f.hz=H.foldOctave(f.hz,ref);});
           F.forEach(f=>{if(f.hz&&!H.onNote(f.hz,ref))f.hz=0;}); }
  F.forEach(f=>f.drawHz=f.hz);
  H.deHash();
  return H.score(null, L);
}
/* HIS VERDICTS. These are the specification. Nothing else in this project is. */
const CASES=[
  ['PERFECT2','NTP-perfect2.wav',    'he said "close to 100"',        92,100],
  ['REF1',    'NTP-steady-ref.wav',  'he said "high 90s"',            92,100],
  ['REF2',    'NTP-less-steady.wav', 'he said "below REF1"',          70, 96],
  ['REF3',    'NTP-spiky.wav',       'he said "the hum is lost"',     35, 65],
  ['SWING23', 'NTP-swing23.wav',     'he said "60s ish"',             50, 75],
  ['SWING63', 'NTP-swing63.wav',     'he said "~63"',                 50, 75],
  ['SWING121','NTP-swing121.wav',    'he said "60s ish"',             50, 75],
  ['REAL-6FT','real-outside-6ft.wav','he said these should be 80s',   78,100],
];
let pass=0, fail=0;
console.log('\n── his recordings, through the real pipeline, against what HE said ──\n');
for(const [name,file,said,lo,hi] of CASES){
  const path='../INBOX/'+file;
  if(!fs.existsSync(path)){ console.log(`  ⏭  ${name} (no audio)`); continue; }
  const {x,sr}=wav(path);
  const t0=Date.now();
  const s=pipeline(x,sr);
  const ms=Date.now()-t0;
  const got = s && s.total!=null ? s.total : null;
  const ok = got!=null && got>=lo && got<=hi;
  ok?pass++:fail++;
  console.log(`  ${ok?'✅':'❌'} ${name.padEnd(9)} ${got==null?(s&&s.refused?'REFUSED '+s.refused:'no score'):got.toFixed(1).padStart(5)}` +
              `   want ${lo}-${hi}   ${said}${s&&s.cracks?'   ('+s.cracks.length+'c)':''}   ${ms}ms`);
}
console.log(`\n${fail===0?'✅ ALL PASS':'❌ FAILURES'}   ${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);

/* ─────────────────────────────────────────────────────────────────────────────
   WHAT THIS SUITE EXPOSED THE DAY IT WAS WRITTEN — three failures, three causes.

   ❌ SWING121 reads 82 against his "60s ish".
      isolate() keeps only 0.0-2.7s of a 6.2s recording - 44% of it - and scores that.
      The pitch spread across the whole clip is -723..+328 cents; across the part that
      survives isolation it is tame. So the scorer is handed the clean opening and never
      sees the part where the hum comes apart, which is the part he graded.

   ❌ REF3 reads 85 against his "the hum is lost".
      97% voiced, pitch spread only -73..+62 cents: by the time the scorer sees it, this
      is a steady hum. It did not start that way - the same recording scored 56 with 11
      cracks through the older, less-filtered pipeline. The wide band, the second look,
      the octave fold and the on-note gate each remove a little of the evidence of
      lostness, and together they repair the hum he graded as broken.

   ❌ REAL-6FT reads 65 against his "these should be 80s".
      The opposite failure. 85% voiced and a raw steadiness of 70, dragged down by three
      cracks that noise manufactured.

   The pattern is one sentence: THE PIPELINE IS TOO KIND TO A BAD HUM AND TOO HARSH ON A
   GOOD ONE IN NOISE. Every cleaning step that rescues a hum from a noisy room also
   rescues a hum that deserved a low score, and nothing in the chain distinguishes them.

   ⚠️ AND THE REASON THIS FILE EXISTS: none of that is visible to hum-test.js, which
   scores stored FRAMES. It has passed all day - it passed while every one of these was
   true - because it tests a pipeline that no longer exists.
   ───────────────────────────────────────────────────────────────────────────── */
