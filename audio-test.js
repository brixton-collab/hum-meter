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
  let ref=H.anchorNote(F.filter(f=>f.hz).map(f=>f.hz));
  /* HARMONIC OCTAVE CHECK — a second opinion from a method that cannot make the same
     mistake. Autocorrelation prefers the lag at twice the period, so at distance it
     answers an octave low: his own A/B has the near hum plotted at F#3 (185 Hz) and the
     SAME hum a few feet further at G2 (98 Hz). A harmonic sum cannot drift that way,
     because a subharmonic predicts harmonics that are not in the spectrum. So when the
     two disagree by an octave, believe the harmonics. */
  /* ⚠️ MEASURED AND IT NEVER FIRES on any audio available - the autocorrelation note and
     the harmonic note AGREE on every file here, including his real six-foot Voice Memo.
     So his octave-at-distance failure is NOT reproducible from anything on disk: the only
     evidence of it is his SCREEN (near hum plotted at F#3 185 Hz, same hum further away at
     G2 98 Hz), and the screen recording's audio dies after 7 seconds and is too poor to
     analyse. To fix that failure I need a VOICE MEMO of the FAR hum. Kept behind a flag. */
  if(process.env.HARMOCT){
    const {harmonicNote}=require('./harmonic.js');
    const LONG=8192, hs=[];
    for(let i=0;i+LONG<=pcm.length;i+=Math.round(sr*0.16)){
      const r=harmonicNote(pcm.subarray(i,i+LONG),sr,LONG); if(r) hs.push(r.hz);
    }
    if(hs.length>=3 && ref){
      const seed=hs.slice().sort((a,b)=>a-b)[hs.length>>1];
      const fold=h=>{while(h>seed*1.5)h/=2; while(h<seed*0.67)h*=2; return h;};
      const f=hs.map(fold).sort((a,b)=>a-b);
      const hnote=f[f.length>>1];
      const cents=1200*Math.log2(hnote/ref);
      if(Math.abs(Math.abs(cents)-1200) < 150) ref = hnote;   // exactly an octave apart
    }
  }
  const noiseFrame = new Array(F.length).fill(false);
  if(ref){ F.forEach(f=>{if(f.hz)f.hz=H.foldOctave(f.hz,ref);});
           F.forEach((f,i)=>{ if(f.hz && !H.onNote(f.hz,ref)){ f.hz=0; noiseFrame[i]=true; } }); }
  /* ── "WE HEARD SOMETHING AND IT WASN'T HIM" IS NOT THE SAME AS "HE STOPPED" ────
     Two different things end up as an unvoiced frame, and lumping them together is what
     has been costing him at six feet.

       · a pitch WAS found and it was nowhere near his note  -> that is the ROOM. A car,
         wind, a bird. It is evidence about the world, not about his hum, and charging
         him for it is charging him for our microphone.
       · no pitch at all                                     -> he may well have stopped.
         That stays exactly as it is - counted, and a crack if it runs long enough.

     This is the distinction every earlier attempt missed. Excluding gaps by LEVEL forgave
     a hum stopping at the ball, because a strike is loud. Excluding them by LENGTH forgave
     it too, because his real breaks are short. But a hum stopping at the ball produces NO
     PITCH - not an off-note one - so this rule leaves it fully charged, which is the whole
     requirement. SWING121 is the test that killed the others; it should be untouched. */
  if(process.env.NOISEGAP) global.__noiseFrames = noiseFrame;
  F.forEach(f=>f.drawHz=f.hz);
  H.deHash();
  const sc = H.score(null, L);
  if(process.env.NOISEGAP && sc && global.__noiseFrames){
    /* re-derive total with the room's frames out of the denominator */
    const nf = global.__noiseFrames;
    const kept = F.length - nf.filter(Boolean).length;
    if(kept > 0){ const scale = F.length / kept;
      sc.total = Math.round(Math.min(100, sc.total*scale)*10)/10; }
  }
  return sc;
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
