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
  /* ── THE HARMONIC-LOCKED TIGHT BAND ───────────────────────────────────────────
     The band the detector listens through is fixed at 90-300 Hz, which is all that can be
     chosen before the note is known. Once a LONG-window harmonic sum has found the note -
     robustly, because a harmonic stack survives what buries a fundamental - the band can
     be centred on it, and that is what lifts the share of frames that land on his note.
     Measured earlier on his own hums at distance: 36% -> 53%.
     Locking to the WRONG note is catastrophic (it removes the hum instead of finding it),
     so this is only adopted when the tight track is more SELF-CONSISTENT than the wide
     one - a track that found the hum clusters around its own median, because a hum is one
     note. Same discipline as the live retune that had to be removed. */
  if(process.env.TIGHT){
    const {harmonicNote}=require('./harmonic.js');
    const LONG=8192, hs=[];
    for(let i=0;i+LONG<=pcm.length;i+=Math.round(sr*0.16)){
      const r=harmonicNote(pcm.subarray(i,i+LONG),sr,LONG); if(r) hs.push(r.hz);
    }
    if(hs.length>=3){
      const seed=hs.slice().sort((x,y)=>x-y)[hs.length>>1];
      const fold=h=>{while(h>seed*1.5)h/=2; while(h<seed*0.67)h*=2; return h;};
      const hf=hs.map(fold).sort((x,y)=>x-y); const hnote=hf[hf.length>>1];
      const tb=P.tightBand(pcm,sr,hnote); const t2=[];
      for(let i=0;i+W<=tb.length;i+=step){
        const d=H.detect(Float32Array.from(tb.subarray(i,i+W)),sr,H.SR_MIN,H.CLARITY_FILTERED);
        t2.push({hz:d?d.hz:0, clarity:d?d.clarity:0});
      }
      const coh=t=>{ const v=t.filter(f=>f.hz).map(f=>f.hz); if(v.length<10) return 0;
        const m=v.slice().sort((x,y)=>x-y)[v.length>>1];
        const ag=v.filter(h=>Math.abs(1200*Math.log2(h/m))<200).length/v.length;
        return (v.length/t.length)*ag*ag; };
      if(coh(t2) > coh(fr)) for(let i=0;i<fr.length;i++){ fr[i]=t2[Math.min(i,t2.length-1)]; }
    }
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
  /* ── THE HARMONIC-STACK DISCRIMINATOR ─────────────────────────────────────────
     For every frame we could not track, ask the one question the pitch track cannot
     answer: IS HIS HARMONIC STACK STILL IN THE AIR?

       stack present -> he is still humming and we lost him. Ours. Not scored, not a crack.
       stack absent  -> he is not humming. His. Counted, and a crack if it runs.

     Measured separation on his real six-foot recording: the stack is present in 83% of
     frames we tracked and 44% of frames we lost. It is INDEPENDENT of the pitch track,
     which is why it can answer what pitch-track statistics could not - his six-foot noise
     and a swing hum coming apart are indistinguishable there (48% vs 56% off-note, 713c
     vs 634c). And a golf strike is broadband with no stack at his note, so a hum stopping
     at the ball reads correctly as HIS - which is where band energy failed. */
  let excused = new Array(F.length).fill(false);
  if(process.env.STACK && ref){
    const {spectrum, magAt} = require('./harmonic.js');
    const MID=2048, st=Math.round(sr*H.HOP/1000);
    for(let i=0;i<F.length;i++){
      /* ⚠️ Also excusing MIS-TRACKED VOICED frames (stack present but our pitch reading
         disagrees) was tried and reverted: SWING23 went to 94 and SWING121 to 83 against
         his "60s ish", while his six-foot case moved 0.2 points. During a swing hum's
         breakup the stack is often still present while the pitch genuinely wanders, so
         the rule excused the breakdown. Only frames with NO pitch are excused. */
      if(F[i].hz) continue;
      const s0=(a+i)*st - (MID>>1);
      if(s0<0 || s0+MID>pcm.length) continue;
      const mag=spectrum(pcm.subarray(s0,s0+MID), MID), binHz=sr/MID;
      let peak=0; for(let k=1;k<mag.length;k++) if(mag[k]>peak) peak=mag[k];
      let hits=0;
      for(let h=1;h<=6;h++){
        const fh=ref*h; if(fh/binHz>=mag.length-2) break;
        const m=magAt(mag,fh,binHz);
        let nb=0,nn=0;
        for(let d=3;d<=9;d++){ const l=Math.round(fh/binHz)-d, r=Math.round(fh/binHz)+d;
          if(l>0){nb+=mag[l];nn++;} if(r<mag.length){nb+=mag[r];nn++;} }
        if(m>peak/40 && m>(nn?nb/nn:0)*1.8) hits++;
      }
      if(hits>=2) excused[i]=true;                // his hum is audibly still there
    }
  }
  global.__excused = excused;
  global.__noiseFrames = noiseFrame;
  F.forEach(f=>f.drawHz=f.hz);
  H.deHash();
  const sc = H.score(null, L);
  if(process.env.STACK && sc){
    const ex = global.__excused.filter(Boolean).length;
    const kept = F.length - ex;
    if(kept > 0 && ex > 0){
      const scale = F.length/kept;
      sc.total = Math.round(Math.min(100, sc.total*scale)*10)/10;
      sc.excused = ex;
    }
  }
  /* ── THE ROOM IS NOT HIS HUM ──────────────────────────────────────────────────
     He graded his own six-foot recording by ear: "90+, super steady, NO BREAKS". The app
     said 65 and found three cracks - so all three are inventions of the room.

     At six feet 85% of frames resolve a pitch but only 45% land on his note. The rest is
     a car, or wind, read as pitch. Those frames sit in the denominator, so the room costs
     him twice: once by breaking the line and once by counting as time he was off it.

     This was tried before and rejected because it inflated the swing hums - a swing hum
     coming apart also produces off-note frames, so the same rule forgave the breakdown.
     WHAT CHANGED IS THAT REAL BREAKS ARE NOW CAUGHT BY LEVEL, INDEPENDENTLY OF PITCH.
     Losing it at the ball is a collapse in loudness, and that is detected whether or not
     the pitch survived. So the off-note frames can be excused without excusing the event
     they used to be a proxy for. */
  if(process.env.ROOM && sc && global.__noiseFrames){
    const nf = global.__noiseFrames;
    const kept = F.length - nf.filter(Boolean).length;
    if(kept > 0){ const scale = F.length/kept;
      sc.total = Math.round(Math.min(100, sc.total*scale)*10)/10; }
  }
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
  ['REF3',    'NTP-spiky.wav',       'RE-GRADED: "50s-60ish, all the breaks"', 45, 65],
  ['SWING23', 'NTP-swing23.wav',     'he said "60s ish"',             50, 75],
  ['SWING63', 'NTP-swing63.wav',     'RE-GRADED: "50s - I lost it at impact"', 42, 62],
  ['SWING121','NTP-swing121.wav',    'he said "60s ish"',             50, 75],
  ['REAL-6FT','real-outside-6ft.wav','GRADED BY EAR: "90+, super steady, no breaks"', 88,100],
  ['FAR-6FT', 'far-hum-6ft.wav',     'GRADED BY EAR: "elite, over 90"', 88,100],
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
