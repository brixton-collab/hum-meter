/* ─────────────────────────────────────────────────────────────────────────────
   HUM CORE — GENERATED. Do not edit.

   Built from hum-meter.html by build-core.py so the simple meter and the full board
   can never disagree about a score. Change the maths in the METER, then:

       python3 build-core.py && ANCHORS=./anchors.json node hum-test.js

   The first version of this file had its constants typed out by hand and two of them
   silently drifted (JUMP_HOLD_MS 120 vs 80; CLARITY_MIN missing entirely, so detect()
   threw outside a browser). A core that disagrees with the page is worse than none —
   every test it passes is a lie about the thing that ships.
   ───────────────────────────────────────────────────────────────────────────── */
let frames = [];
function setFrames(f){ frames = f; }
function getFrames(){ return frames; }

const HOP = 40;                       // ms between pitch frames
const SR_MIN = 70, SR_MAX = 400;      // plausible hum band
const JUMP_CENTS = 50;                // pitch move that counts as a crack...
const JUMP_HOLD_MS = 80;              // ...but only if it STAYS moved this long
const CLARITY_MIN = 0.52;             // below this the frame isn't a tone (RAW audio)
const CLARITY_FILTERED = 0.36;        // ...and this is the bar once the audio IS filtered
const CLARITY_GATE = 0.45;            // below this the RECORDING is too rough to score
const OCTAVE_OFF_CENTS = 150;         // this far off the note = wrong octave, not vibrato
const HUSH_MS = 1400;                 // silence this long after a hum = you're done
const CAL = {
  // REBUILT 2026-08-18 for the steadiness rewrite. The old weights/scales belonged to
  // wobble+drift and are gone; nothing here is tuned by feel.
  //
  // The BANDS are Brixton's, unchanged, and they survived the rewrite untouched — his
  // three Nail the Pitch reference recordings land 99.6 / 80.9 / 66.2 against them.
  //
  // The PERCENTILES are measured, not asserted: 28 real hums (21 population + his 3
  // references + 4 swing hums) rescored under the new metric. They exist only so
  // "better than X% of hums measured" is a true sentence. Recompute them with
  // hum-steady.py whenever the population grows — never hand-edit.
  //
  // There is no scale left to calibrate. The score is a direct physical measurement —
  // the % of the span you spent on your own line — not a percentile of a population,
  // so "you held your line 88% of the time" means the same thing in week 1 and week 30.
  "bands":   { "ELITE": 85, "CLEAN": 70, "SHAKY": 60 },
  "percentiles": {"5": 66.0, "10": 67.6, "25": 71.3, "50": 77.5, "75": 83.4, "90": 94.9, "95": 96.0}
};
const VIEW_CENTS = 350;
const NOTE_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const TOL_CENTS = 25, TREND_MS = 200, HOLD_MIN_MS = 50, GASP_CENTS = 100, GASP_GAP_MS = 250;
const CRACK_CAP = 74.9, CRACK_JUMP_C = 100, CRACK_JUMP_MS = 160,
      CRACK_DROP_MS = 100, CRACK_TAIL_MS = 150;
const ISO_NEAR_C = 150, ISO_ON_FRAC = 0.40, ISO_MAX_GAP_MS = 1200, ISO_MIN_MS = 700;
const FOLD_CENTS = 50, FOLD_MAX_FRAMES = 2;
const LOCK_MIN_FRAMES = 25, LOCK_AGREE = 0.70, LOCK_TOL_C = 80, TUNE_FLOOR_HZ = 105;
const OFF_NOTE_C = 400;
const median=a=>{ const s=[...a].sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };
const sd=a=>{ if(a.length<2) return 0; const m=a.reduce((x,y)=>x+y,0)/a.length;
  return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length); };

function detect(buf, sr, floor, cmin){
  // remove DC, check we have signal at all
  let mean=0; for(let i=0;i<buf.length;i++) mean+=buf[i]; mean/=buf.length;
  let rms=0; for(let i=0;i<buf.length;i++){ buf[i]-=mean; rms+=buf[i]*buf[i]; }
  rms=Math.sqrt(rms/buf.length);
  /* ⚠️ THIS NUMBER DECIDES WHETHER A SOFT HUM EXISTS AT ALL, and it was far too high.
     At 0.008 a gentle hum with the phone on the ground never reached the pitch detector -
     the frame was discarded as "silence" before anything looked at it, and no amount of
     loosening the gates downstream could bring it back. Brixton: "it's not picking up, you
     should pick up on a soft hum, you have to really do it."
     0.0010 is still above a phone's own noise floor (~0.0005), so silence is
     still silence - which matters, because the hands-free stop depends on quiet reading
     as quiet. Clarity is what rejects noise, and clarity is level-independent: the
     autocorrelation is normalised, so a quiet hum scores the same as a loud one. */
  if(rms<0.0010) return null;                     // silence

  const lo = Math.max(SR_MIN, floor||SR_MIN);
  const lagMin=Math.floor(sr/SR_MAX), lagMax=Math.min(Math.floor(sr/lo), buf.length-2);
  if(lagMax<=lagMin) return null;
  let best=-1, bestV=0, r0=0;
  for(let i=0;i<buf.length;i++) r0+=buf[i]*buf[i];
  for(let lag=lagMin; lag<=lagMax; lag++){
    let s=0, e=0;
    for(let i=0;i<buf.length-lag;i++){ s+=buf[i]*buf[i+lag]; e+=buf[i+lag]*buf[i+lag]; }
    const v = s/Math.sqrt((r0||1)*(e||1));         // normalised → 0..1 clarity
    if(v>bestV){ bestV=v; best=lag; }
  }
  if(best<0 || bestV<(cmin||CLARITY_MIN)) return null;

  // parabolic interpolation for sub-sample accuracy (matters a lot at 100 Hz)
  const y=l=>{ let s=0; for(let i=0;i<buf.length-l;i++) s+=buf[i]*buf[i+l]; return s; };
  const a=y(best-1), b=y(best), c=y(best+1);
  const shift = (a-c) ? 0.5*(a-c)/(a-2*b+c) : 0;
  return { hz: sr/(best+shift), clarity: bestV, rms };
}
function noteOf(hz){
  const midi = Math.round(69 + 12*Math.log2(hz/440));
  return { name: NOTE_NAMES[(midi%12+12)%12] + (Math.floor(midi/12)-1),
           hz: 440*Math.pow(2,(midi-69)/12) };
}
function robustNote(hz){
  if(!hz.length) return 0;
  let sx=0, sy=0;
  hz.forEach(f=>{ const folded = f * Math.pow(2, -Math.floor(Math.log2(f/100)));
    const a = 2*Math.PI*Math.log2(folded/100); sx+=Math.cos(a); sy+=Math.sin(a); });
  let ang = Math.atan2(sy,sx); if(ang<0) ang += 2*Math.PI;
  const base = 100*Math.pow(2, ang/(2*Math.PI));
  let best=null;
  for(let k=-2;k<=2;k++){
    const cand = base*Math.pow(2,k);
    if(cand<SR_MIN||cand>SR_MAX) continue;
    const agree = hz.filter(f=>Math.abs(1200*Math.log2(f/cand))<OCTAVE_OFF_CENTS).length;
    if(!best||agree>best[0]) best=[agree,cand];
  }
  return best ? best[1] : median(hz);
}
function foldOctave(hz, ref){
  if(!hz || !ref) return hz;
  for(let k=1;k<=2;k++){
    const up = hz*Math.pow(2,k);
    if(up <= SR_MAX*1.05 && Math.abs(1200*Math.log2(up/ref)) < FOLD_CENTS) return up;
  }
  return hz;
}
function foldRun(fr, ref){
  if(!ref) return;
  const isOff = f => f.hz && Math.abs(1200*Math.log2(foldOctave(f.hz,ref)/f.hz)) > 1;
  let i=0;
  while(i<fr.length){
    if(!isOff(fr[i])){ i++; continue; }
    let j=i; while(j<fr.length && isOff(fr[j])) j++;
    if(j-i <= FOLD_MAX_FRAMES)
      for(let k=i;k<j;k++) fr[k].hz = foldOctave(fr[k].hz, ref);
    i=j;
  }
}
function anchorNote(hzList){
  if(!hzList || hzList.length < 6) return 0;
  let r = robustNote(hzList);
  if(!r) return 0;
  const near = t => hzList.filter(h=>Math.abs(1200*Math.log2(h/t))<60).length;
  if(r*2 <= SR_MAX && near(r*2) > near(r)) r *= 2;
  return r;
}
function lockNote(hzList){
  if(!hzList || hzList.length < LOCK_MIN_FRAMES) return 0;
  const cand = anchorNote(hzList);
  if(!cand || cand < TUNE_FLOOR_HZ || cand > SR_MAX) return 0;
  const near = hzList.filter(h=>Math.abs(1200*Math.log2(h/cand)) < LOCK_TOL_C).length;
  return (near/hzList.length) >= LOCK_AGREE ? cand : 0;
}
function onNote(hz, ref){
  if(!hz || !ref) return hz;
  return Math.abs(1200*Math.log2(hz/ref)) > OFF_NOTE_C ? 0 : hz;
}
function confirmNoteOctave(note){
  for(let lift=0; lift<2; lift++){
    const cand = note*2;
    if(cand > SR_MAX) break;
    let voiced=0, agree=0, tested=0;
    frames.forEach(f=>{
      if(!f.buf) return;
      tested++;
      const d = detect(Float32Array.from(f.buf), sampleRate, note*1.6);
      if(d){ voiced++; if(Math.abs(1200*Math.log2(d.hz/cand))<OCTAVE_OFF_CENTS) agree++; }
    });
    if(!tested || voiced/tested < 0.8 || !voiced || agree/voiced < 0.8) break;
    note = cand;
  }
  return note;
}
function resolveOctaves(note){
  const off = frames.map(f => f.hz && Math.abs(1200*Math.log2(f.hz/note))>=OCTAVE_OFF_CENTS);
  if(!off.some(Boolean)) return;
  const minReal = Math.max(2, Math.round(JUMP_HOLD_MS/HOP));

  let i=0;
  while(i<frames.length){
    if(!off[i]){ i++; continue; }
    let j=i; while(j<frames.length && off[j]) j++;

    let confirms=0, contradicts=0, snap=[], ok=true;
    for(let k=i;k<j;k++){
      const p = Math.round(Math.log2(note/frames[k].hz));
      const cand = frames[k].hz*Math.pow(2,p);
      // only a clean power of two is an octave error; anything else is the voice
      if(p===0 || Math.abs(1200*Math.log2(cand/note))>=OCTAVE_OFF_CENTS){ ok=false; break; }
      snap.push(cand);
      const d = frames[k].buf ? detect(Float32Array.from(frames[k].buf), sampleRate, note*0.8) : null;
      if(d){ if(Math.abs(1200*Math.log2(d.hz/note))<OCTAVE_OFF_CENTS) confirms++; else contradicts++; }
    }
    if(ok && !contradicts && ((j-i)<minReal || confirms>=2))
      for(let k=i;k<j;k++) frames[k].hz = snap[k-i];
    i=j;
  }
}
function deHash(){
  const raw = frames.map(f=>f.hz);
  for(let i=0;i<frames.length;i++){
    const w=[raw[i-1],raw[i],raw[i+1]].filter(x=>x>0).sort((a,b)=>a-b);
    if(w.length) frames[i].hz = w[w.length>>1];
  }
}
function isolate(fr){
  const idx=[]; fr.forEach((f,i)=>{ if(f.hz) idx.push(i); });
  if(idx.length<10) return [0, fr.length];
  const centre = median(idx.map(i=>fr[i].hz));
  const off = hz => Math.abs(1200*Math.log2(hz/centre));
  const look = Math.round(2000/HOP), maxGap = Math.round(ISO_MAX_GAP_MS/HOP);
  const start = idx[0]; let end = start;
  for(let k=0;k<idx.length-1;k++){
    const a=idx[k], b=idx[k+1];
    if(b-a<=1){ end=b; continue; }
    const nxt = fr.slice(b, b+look);
    const on  = nxt.filter(f=>f.hz);
    /* ⚠️ THE HUM ENDS AT SILENCE, NOT AT AN OFF-NOTE PATCH.

       This used to require the audio after a gap to resume ON HIS NOTE and gave up if it
       did not - so it ended the hum at the first sustained off-note excursion, which is
       the event this meter exists to measure. Measured on SWING121: the voiced track runs
       essentially unbroken across all 6.2 s and isolate kept 0.0-2.7s. The scorer was
       handed the clean opening and never saw the part that comes apart.

       HOW IT WAS CONFIRMED, because the scores alone were ambiguous. Fixing it moved
       SWING121 82 -> 73 (right) and SWING63 62 -> 43 (apparently wrong against his
       recorded grade of "~63"). So he was sent the raw audio and asked to listen to the
       whole clip, and he re-graded it: "swing63 I'd grade in the 50s BECAUSE I LOST IT AT
       IMPACT."

       His original 63 had been given while looking at the graph the app drew - a graph
       that had already thrown away the half where he lost it. The truncation was hiding
       the very thing he grades on, and it was hiding it from him as well as from the
       scorer. A gap ends the hum when it is LONG; what note the voice returns on is the
       measurement, not the boundary.                                                    */
    const resumes = on.length>=5 && (on.length/Math.max(1,nxt.length)) >= ISO_ON_FRAC;
    if(b-a<=maxGap && resumes){ end=b; continue; }
    break;
  }
  const tail = idx.filter(i=>i>=end);
  if(tail.length){ let j=0; while(j<tail.length-1 && tail[j+1]-tail[j]<=1) j++; end=tail[j]; }
  if((end-start)*HOP < ISO_MIN_MS) return [0, fr.length];
  return [start, end+1];
}
/* THE ROAD IS NOT PART OF HIS HUM'S LOUDNESS.
   `noiseFloor` is the level of the background measured BEFORE he started humming - pure
   road, wind and mic. Every level test below asks "did his hum drop away", and a constant
   additive floor makes the answer no: measured, REF3 - the hum he graded "lost" - drops to
   17% of its own median when clean and stops registering as a drop at all next to a road,
   so its 5 cracks become 0 and its score RISES 61 -> 78. Noise flattering a bad hum is the
   more dangerous half of the noise problem, because nobody ever complains about it.
   Subtracting the floor restores the depth of the collapse without touching a clean hum,
   where the floor is ~0 and every number below is unchanged. */
function score(rumble, level, noiseFloor){
  const NF = (noiseFloor>0) ? noiseFloor : 0;
  const lvlAt = i => { const v = level && level[i]; return v==null ? null : Math.max(0, v-NF); };
  const [i0,i1] = isolate(frames);
  const hum = frames.slice(i0,i1);
  /* ⚠️ THE SPAN MUST START AT A REAL HUM, NOT AT THE FIRST FRAME THAT READS AS PITCH.

     This used to be findIndex(f=>f.hz) - the very first voiced frame anywhere - and that
     was survivable only while the detector was deaf. Now that the live audio is filtered
     and the clarity bar for filtered audio is 0.36, the QUIET LEAD-IN is no longer
     silent: a tight band-pass around his note turns ordinary room and road noise into
     the occasional voiced frame. One of those, seconds before he starts, drags the span
     back to include all the silence in between - and `total` is the share of the SPAN
     spent on his line, so a hum that fills half the window can score half of what it
     deserves before the crack multiplier has even been applied.

     Measured on his own board recording: the hum occupied a little over half the plot,
     the rest was lead-in, and it scored 35 for a hum he called 65-70.

     So an onset is a RUN, not a frame: 200 ms of continuous pitch is a voice starting.
     A single frame is noise, and noise is what the lead-in is made of. */
  /* ⚠️ THE SPAN IS THE BODY OF THE HUM, NOT EVERYTHING FROM THE FIRST BLIP TO THE LAST.

     He graded two of his own six-foot recordings by ear - "90+, super steady, NO BREAKS"
     and "elite, over 90" - and the scorer found three and five cracks in them. Where they
     sat is the whole story:

         REAL-6FT (no breaks)   0.4s, 0.8s ................... 11.9s     clip is 14.9s
         FAR-6FT  (no breaks)   0.6s, 0.9s, 1.2s, 1.6s ....... 9.6s      clip is  9.9s
         REF3     (all breaks)  ..... 3.3 4.3 4.6 7.9 11.3 12.9s
         SWING63  (lost at ball) .... 4.4 4.5 4.6s

     Every false crack is at the very start or the very end; every real one is in the body.
     That is him pressing record and walking into position, and walking back afterwards -
     and in the app it is the tap, the walk to the ball and the set-up. It is not his hum,
     and it was being scored as the worst part of it.

     So the span now starts where the hum is genuinely UP - sustained pitch at a level
     comparable to the body of the hum - and ends where it drops away for good. A quiet
     approach cannot open the span, and a fade-out cannot close it late. */
  const ONSET = Math.max(2, Math.round(200/HOP));
  const runStart = (arr, dir) => {
    const idx = dir>0 ? arr.map((_,i)=>i) : arr.map((_,i)=>arr.length-1-i);
    let run = 0;
    for(const i of idx){
      if(arr[i].hz){ run++; if(run >= ONSET) return dir>0 ? i-run+1 : i+run-1; }
      else run = 0;
    }
    return -1;
  };
  const bodyLvl = (()=>{
    if(!level || !level.length) return null;
    const v=[]; for(let i=0;i<hum.length;i++){ const q=lvlAt(i0+i); if(q!=null && hum[i].hz) v.push(q); }
    return v.length>=10 ? median(v)*0.45 : null;
  })();
  const upAt = (dir) => {
    const idx = dir>0 ? hum.map((_,i)=>i) : hum.map((_,i)=>hum.length-1-i);
    let run=0;
    for(const i of idx){
      const loud = bodyLvl==null || (lvlAt(i0+i)!=null && lvlAt(i0+i) >= bodyLvl);
      if(hum[i].hz && loud){ run++; if(run>=ONSET) return dir>0 ? i-run+1 : i+run-1; }
      else run=0;
    }
    return -1;
  };
  let first = upAt(1), last = upAt(-1);
  if(first<0 || last<0){ first = runStart(hum, 1); last = runStart(hum, -1); }
  // if nothing ever sustained, fall back to the old behaviour rather than refuse
  if(first < 0 || last < 0){
    first = hum.findIndex(f=>f.hz);
    last  = hum.length-1-[...hum].reverse().findIndex(f=>f.hz);
  }
  if(first < 0 || last-first < 20) return null;
  const span = hum.slice(first, last+1);              // trim lead-in / tail silence
  const voiced = span.map(f=>!!f.hz);
  const vh = span.filter(f=>f.hz).map(f=>f.hz);
  if(vh.length < 15) return null;

  const note = median(vh);
  const cents = vh.map(h=>1200*Math.log2(h/note));
  const k = Math.max(1, Math.round(TREND_MS/HOP/2));
  const path = cents.map((_,i)=>median(cents.slice(Math.max(0,i-k), i+k+1)));
  /* ── SUBTRACT OUR OWN MEASUREMENT NOISE ───────────────────────────────────────
     This is the rule the whole day kept arriving at, finally stated properly: do not
     charge a golfer for OUR error.

     `dev` is how far each frame sits from the local trend, and it contains two things
     that are not the same - how much his pitch actually moved, and how badly we measured
     it. On clean audio the second term is negligible. On a road it is not, and it is why
     the same hum collapsed: noise inflates dev everywhere, more frames fall outside the
     25-cent tolerance, and enough of them cross 100 cents to manufacture cracks he never
     made. Measured: REF2 went 90 with zero cracks to 56 with seven, purely from adding
     his own road recording underneath his own hum.

     The measurement noise can be estimated, because a human voice cannot move much in
     40 ms. Frame-to-frame change beyond the physiological limit is not him - it is us.
     Taking a ROBUST spread of the frame differences (MAD, so a real crack does not
     inflate it) gives sigma, and subtracting it in quadrature leaves the movement that
     was actually his:

         dev_true = sqrt( max(0, dev^2 - sigma^2) )

     On a clean hum sigma is a few cents and nothing changes - his graded anchors are
     the proof. On a noisy one sigma is large and the score stops collapsing. An
     instrument that knows its own precision reports the signal, not the error bar. */
  const diffs = [];
  for(let i=1;i<cents.length;i++) diffs.push(Math.abs(cents[i]-cents[i-1]));
  const sigma = diffs.length ? Math.min(40, median(diffs)*1.4826/Math.SQRT2) : 0;
  const dev  = cents.map((c,i)=>Math.sqrt(Math.max(0, (c-path[i])*(c-path[i]) - sigma*sigma)));

  // dev laid back onto the full span, so a dropout and a spike are the same axis
  const devSpan = new Array(span.length).fill(null);
  let vi=0; for(let i=0;i<span.length;i++) if(voiced[i]) devSpan[i]=dev[vi++];

  /* ⚠️ EXCLUDING UNMEASURABLE TIME FROM THE DENOMINATOR WAS TRIED HERE AND REVERTED.

     The idea was sound and the measurements were good almost everywhere: dividing only
     by time we could actually hear took PERFECT2 in heavy noise from 62 to 85, REF2 from
     56 to 66, SWING63 from 42 to 56. It failed on the case the product exists for.

     A SWING hum stops at the ball. That stop is the measurement - it is the restriction
     Brixton wants a golfer to see. But a strike is loud, so "the band is still loud, so
     we must have failed to hear him" is exactly true at impact, and the frame gets
     excluded instead of counted. SWING121 went from 68 to 89 against his own "60s ish":
     the rule forgave precisely the event it should have caught. Narrowing the level
     measurement to his note instead of the whole band did not separate them either.

     So the span stays the span. If a better discriminator between "he stopped" and "we
     went deaf" turns up, this is where it goes - but it has to survive SWING121. */
  /* ⚠️ FORGIVING SHORT GAPS IN THE DENOMINATOR: TRIED TWICE, REVERTED TWICE.

     The pull is real. Walking his phone a few feet away drops the share of frames that
     resolve a pitch from 98% to 64%, and `total` is the share of the SPAN spent on his
     line - so a third of it is lost before scoring begins, and the same hum reads 96 on
     the phone and 33 at three feet. He is right that both should be over 90.

     Both attempts to fix it here died on the same clip. Deciding by LEVEL (band still
     loud = we went deaf) forgave a swing hum stopping at the ball, because a strike is
     loud: SWING121 68 -> 89 against his "60s ish". Deciding by LENGTH (gaps under 200 ms
     are ours) forgave it too - his real breaks are made of short gaps: SWING121 -> 88.5,
     out of band. There is no boundary here that separates "we could not hear him" from
     "he stopped" without also excusing the restriction the meter exists to find.

     Which means this is not a scoring problem. At three feet the front end resolves 64%
     of frames, 25% of those are off-note and 10% are a clean octave out. Fix the
     DETECTION and the denominator stops mattering; patch the denominator and SWING121
     breaks every time. (YIN was tried for the detection side and did not move the
     distance numbers either - see the git history for that build.) */
  const onLine = devSpan.map(d=>d!==null && d<=TOL_CENTS);
  const total  = onLine.filter(Boolean).length / span.length * 100;
  const line   = dev.filter(d=>d<=TOL_CENTS).length / dev.length * 100;
  const onAir  = voiced.filter(Boolean).length / span.length * 100;

  // TENSION EVENTS: breath hold -> gasp. This is the coaching output, not a stat.
  const minHold = Math.max(1, Math.round(HOLD_MIN_MS/HOP));
  const gapMax  = Math.round(GASP_GAP_MS/HOP);
  const holds=[]; for(let i=0;i<span.length;){
    if(!voiced[i]){ let j=i; while(j<span.length && !voiced[j]) j++;
      if(j-i>=minHold) holds.push([i,j]); i=j; } else i++; }
  const gasps=[]; for(let i=0;i<span.length;){
    if(devSpan[i]!==null && devSpan[i]>GASP_CENTS){ let j=i, mx=0;
      while(j<span.length && devSpan[j]!==null && devSpan[j]>GASP_CENTS){ mx=Math.max(mx,devSpan[j]); j++; }
      gasps.push([i,j,mx]); i=j; } else i++; }
  const tension=[];
  for(const [h0,h1] of holds) for(const [g0,,mx] of gasps)
    if(g0>=h1 && g0-h1<=gapMax){ tension.push({at:(h0*HOP)/1000, holdMs:Math.round((h1-h0)*HOP), gasp:Math.round(mx)}); break; }

  // Least-squares slope over the whole path, NOT path[last]-path[0]. The endpoint
  // difference is precisely what made the old `drift` untrustworthy: it reads two frames
  // and ignores everything between them, so one noisy end frame invents a tilt that is
  // not there. (Measured: it claimed -188c on a reference hum that is level to -5c.)
  const n = path.length, xm = (n-1)/2, ym = path.reduce((a,b)=>a+b,0)/n;
  let num=0, den=0;
  for(let i=0;i<n;i++){ num += (i-xm)*(path[i]-ym); den += (i-xm)*(i-xm); }
  // CRACKS: an audible break. The last 150 ms is exempt - on a swing hum that is impact,
  // and impact is the strike, not a crack.
  let noiseGaps = 0;
  /* ⚠️ 400 ms AT BOTH ENDS, NOT 150. Even after the span is trimmed to the body of the
     hum, the first and last moments are the voice arriving and leaving - pitch is
     unsettled there by definition, and at six feet it is unsettled for longer because
     there is less of it to work with. Measured on the recording he graded "90+, super
     steady, NO BREAKS": the only two cracks left sat at 0.2s and 11.3s of an 11.8s span,
     both just inside a 150 ms guard. His real breaks are nowhere near the edges - REF3's
     run 3.3s to 12.9s of 18s, SWING63's cluster at 4.4-4.6s - so widening the guard
     cannot hide the events that matter. */
  const EDGE_MS = 400;
  const guard = span.length - Math.round(EDGE_MS/HOP);
  /* A HEAD GUARD, symmetric with the tail one. The tail was exempt because on a swing
     hum the last 150 ms is impact, and impact is the strike rather than a crack. The
     same argument applies at the front and was simply never made: the first 150 ms is
     the voice ARRIVING - pitch is unsettled there by definition, and the filter is still
     ringing up - so a "crack" in it is the recording starting, not the golfer cracking. */
  const headGuard = Math.round(EDGE_MS/HOP);
  const cracks=[];
  for(let i=0;i<span.length;){
    if(devSpan[i]!==null && devSpan[i]>CRACK_JUMP_C){
      let j=i, mx=0;
      while(j<span.length && devSpan[j]!==null && devSpan[j]>CRACK_JUMP_C){ mx=Math.max(mx,devSpan[j]); j++; }
      /* ⚠️ CLARITY WAS TRIED HERE AS A "was this really him?" TEST FOR JUMPS, THE WAY
         BAND ENERGY WORKS FOR DROPOUTS, AND IT WAS REVERTED. It does not separate the
         two cases, because clarity falls during a REAL crack as well - the voice is
         disintegrating, which is exactly what the detector reports as low confidence.
         Measured: it deleted real cracks from his swing hums and took SWING121 from 68
         to 82 against his own "60s ish". A discriminator that cannot tell the two apart
         just deletes evidence.
         Band energy works for dropouts because it answers a different question - is the
         hum still THERE - and there is no equivalent for a jump. Left as-is on purpose. */
      if((j-i)*HOP>=CRACK_JUMP_MS && i<guard && i>=headGuard)
        cracks.push({kind:'jump', at:(i*HOP)/1000, ms:Math.round((j-i)*HOP), cents:Math.round(mx)});
      i=j;
    } else if(!voiced[i]){
      let j=i; while(j<span.length && !voiced[j]) j++;
      /* ⚠️ "THE VOICE BROKE" vs "WE LOST THE SIGNAL" - these are not the same event and
         charging for both is what noise does to a score.

         Measured with the noise suite, mixing his own road recording into his own graded
         hums: REF2 went from 90 with ZERO cracks to 56 with SEVEN the moment a quiet road
         was added. He had not hummed any differently. Every one of those cracks was a
         stretch where the detector could no longer resolve his hum through the noise.

         There is a physical difference and it is easy to read. When a voice genuinely
         stops, the energy IN THE HUM BAND goes with it. When noise merely swamps the
         detector, the band stays loud - the hum is still there, we just cannot resolve
         a period out of it. So a dropout only counts as a crack if the band actually
         went quiet. If it stayed loud, we failed to hear him; that is our problem, not
         his, and it is reported as noise rather than charged to his score. */
      const gapCounts = (()=>{
        if(!level || !level.length) return true;              // no level data - old behaviour
        const base = i0 + first;
        const voicedLv = [], gapLv = [];
        for(let k=0;k<span.length;k++){ const v = lvlAt(base+k);
          if(v==null) continue; (voiced[k] ? voicedLv : gapLv).push(v); }
        if(voicedLv.length < 5) return true;
        const ref = median(voicedLv);
        let sum=0, n=0;
        for(let k=i;k<j;k++){ const v = lvlAt(base+k); if(v!=null){ sum+=v; n++; } }
        if(!n) return true;
        return (sum/n) < ref*0.5;                             // band went quiet => a real break
      })();
      if((j-i)*HOP>=CRACK_DROP_MS && i>=headGuard && i<guard){
        if(gapCounts) cracks.push({kind:'drop', at:(i*HOP)/1000, ms:Math.round((j-i)*HOP), cents:0});
        else noiseGaps++;
      }
      i=j;
    } else i++;
  }
  /* ── THE WIND FILTER ──────────────────────────────────────────────────────────
     Brixton: "build in your wind filter."

     A gust does not make a golfer's hum crack - it makes the DETECTOR crack. The gust
     lands, the fundamental is masked for a few frames, the track drops out, and the
     scorer books it as a break in the voice. Measured on the synthetic wind suite that
     is worth up to 9 points on a swing hum, and it is invisible: he would never know a
     number was wrong, which makes it worse than a refusal he can argue with.

     Refusing the whole recording was the old answer and it is the wrong one - his rule
     is ALWAYS SCORE IT, and a 25 mph gale still scores a clean hum 100. So attribute
     instead of refuse: a crack that lands ON a rumble spike is not his, so it does not
     count against him and it does not trigger the cap. It is still reported, as wind.

     The threshold is the 90th PERCENTILE of rumble, not the mean, because wind is peaky
     by nature and the mean is dominated by the calm between gusts - clean audio tops out
     around 0.32 and anything genuinely windy is 0.46+. */
  let windCracks = 0;
  if(rumble && rumble.length){
    const r = [...rumble].filter(x=>x!=null).sort((a,b)=>a-b);
    const p90 = r.length ? r[Math.min(r.length-1, Math.round(0.90*(r.length-1)))] : 0;
    if(p90 > 0.46){
      const base = i0 + first;                       // span index -> frames index
      const gusty = i => { const v = rumble[base + i]; return v != null && v >= p90; };
      const kept = cracks.filter(c=>{
        const a = Math.round(c.at*1000/HOP), b = a + Math.round(c.ms/HOP);
        for(let i=a;i<=b;i++) if(gusty(i)) return false;   // a gust sat on it - not his
        return true;
      });
      windCracks = cracks.length - kept.length;
      cracks.length = 0; kept.forEach(c=>cracks.push(c));
    }
  }

  /* ── A BREAK IN LOUDNESS IS A BREAK ───────────────────────────────────────────
     Everything above asks whether he HELD THE NOTE. Nothing asked whether the hum was
     still THERE, and those are not the same question.

     REF3 is the proof. He graded it "the hum is lost ... all the breaks, I'd put it 50s,
     60 ish". The scorer said 85 with ZERO cracks, because his pitch never wandered - it
     drops out three times mid-clip while staying exactly on note, and a dropout is only
     seen when the PITCH disappears. Measured against its own peak, 17% of REF3 sits under
     a quarter of its own loudness, against 5-6% for the two hums he graded in the 90s.

     So a sustained collapse in level, relative to the body of his own hum, is a break -
     and it is charged as one whether or not the pitch survived it. This is also the same
     event as losing it at the ball, which is the thing the meter is FOR.               */
  if(level && level.length){
    const base = i0 + first;
    const lv = []; for(let i=0;i<span.length;i++){ const v=lvlAt(base+i); if(v!=null && voiced[i]) lv.push(v); }
    if(lv.length >= 10){
      const ref = median(lv), floor = ref*0.30, need = Math.round(150/HOP);
      for(let i=0;i<span.length;){
        const v = lvlAt(base+i);
        if(v == null || v >= floor){ i++; continue; }
        let j=i; while(j<span.length && lvlAt(base+j)!=null && lvlAt(base+j)<floor) j++;
        /* ⚠️ A BREAK HAS HUM ON BOTH SIDES OF IT. Every hum tapers at the end, and the
           first version of this charged that taper as a break - his PERFECT2, which he
           graded ~100, dropped to 74 for the way it finished. A fade is only a break if
           he PICKED IT BACK UP, which is exactly how he describes the event: "you can
           hear me hum, then I hit the ball (lose the hum), then hum picks back". So
           require the hum to come back loud enough, after the quiet patch, to prove it
           was a break in the middle and not the ending. */
        const after = []; for(let k=base+j;k<base+j+need*2;k++){ const q=lvlAt(k); if(q!=null && q>=ref*0.6) after.push(q); }
        const cameBack = after.length >= Math.min(need, 3);
        if(cameBack && (j-i) >= need && i>=headGuard && i<guard &&
           !cracks.some(c=>{ const a2=Math.round(c.at*1000/HOP); return a2<j && a2+Math.round(c.ms/HOP)>i; }))
          cracks.push({kind:'fade', at:(i*HOP)/1000, ms:Math.round((j-i)*HOP), cents:0});
        i=j;
      }
      cracks.sort((a,b)=>a.at-b.at);
    }
  }

  // THE CRACK RULE, and the fix to it.
  // Brixton: "if the hum cracks, the score has to be definitely below 75."
  // A flat ceiling did that — and piled every cracked hum onto exactly 74.9, so a badly
  // lost hum and a mildly cracked one read the same number. Useless to a golfer trying to
  // improve. So the ceiling COMPRESSES instead of clipping: a cracked hum is scaled into
  // 0..74.9 by how good it otherwise was. Ordering is preserved, the rule is honoured,
  // and the range below 75 is actually used.
  /* ── AND THE FIX TO THE FIX (2026-08-19). ────────────────────────────────────
     `total * 0.749` is a FLAT 25% HAIRCUT, and a flat haircut turns the crack rule into
     a cliff. Measured on four of his hums in a row: a clean one scored 89, and one that
     was identical apart from a SINGLE 100 ms dropout scored 63. One dropout, 26 points.
     He felt it immediately - "the 63s maybe should have been like 68s" - and he is
     right, because nothing about those two hums is 26 points apart.

     The rule stays: he locked "if the hum cracks, the score has to be definitely below
     75", and 74.9 is still the ceiling. What changes is that the drop below it is now
     proportional to the DAMAGE - how much of the hum the cracks actually destroyed -
     instead of being the same 25% whether you lost 100 ms or two seconds. One short
     crack lands just under the ceiling; a hum that keeps falling apart still goes deep.

     This is the same mistake as the original flat ceiling, one level down. That one
     piled every cracked hum onto exactly 74.9; this one piled them all onto 0.749x. */
  const capped = cracks.length > 0 && total > CRACK_CAP;
  /* TWO TERMS, AND THE SECOND ONE IS CRACK COUNT - which is what HIS OWN GRADES separate
     on, once you lay them out. Scaling by total crack MILLISECONDS was tried first and
     collapsed three anchors onto exactly 48.7, which is the original flat-ceiling bug
     wearing a different number. The measurement that killed it:

       REF3    11 cracks, 148 ms lost per second   he said "the hum is lost"
       SWING63  5 cracks, 191 ms lost per second   he said "~63"

     Nearly the same damage, and he graded them fifteen points apart - so damage alone
     cannot be the answer, and neither can `total`: REF3's pitch is STEADIER than
     SWING63's between the breaks. What actually separates them is how many times the
     hum broke. Five breaks is a swing hum, which is what a swing hum does. Eleven is a
     hum that keeps falling apart, and that is what he means by lost.

     So: a gentle curve on total keeps a nearly-clean hum just under the 74.9 ceiling
     (one short crack now reads 68 instead of 63 - his correction), and a count term
     takes a hum that keeps breaking down into the 40s. The first crack is free of the
     count term on purpose: one break should cost you the ceiling, not the floor. */
  const shape   = Math.pow(Math.max(0,total)/100, 0.55);
  const repeats = 1 - Math.min(0.30, Math.max(0, cracks.length-1)*0.03);
  const finalTotal = cracks.length ? Math.min(total, CRACK_CAP*shape*repeats) : total;

  const tilt = den ? (num/den)*(n-1) : 0;
  // (f.clarity||0): deHash can turn a previously-unvoiced frame voiced, and those frames
  // were pushed without a clarity value. One undefined turns the whole average into NaN,
  // which is what put "NaN" on screen where a percentage should be.
  const clar = span.filter(f=>f.hz).reduce((s,f)=>s+(f.clarity||0),0)/Math.max(vh.length,1);
  return { total: Math.round(finalTotal*10)/10, line, onAir, tension, tilt, note, cracks, capped, windCracks, noiseGaps,
           humStart: i0+first, humWindow: [i0*HOP/1000, i1*HOP/1000],
           jitter: median(dev)*1.4826, sigma, held:(vh.length*HOP)/1000,
           span:(span.length*HOP)/1000, purity: clar, rough: clar < CLARITY_GATE };
}
function beats(total){
  const ps = Object.keys(CAL.percentiles).map(Number).sort((a,b)=>a-b);
  let below = 0;
  ps.forEach(p=>{ if(total >= CAL.percentiles[String(p)]) below = p; });
  if(total < CAL.percentiles[String(ps[0])]) return null;
  return below;
}
/* ── WIND / NOISE GATE ────────────────────────────────────────────────────────
   Brixton: "hey, too windy, redo your hum."

   Range wind is not a small problem: one of his range clips found ZERO hums until
   it was high-passed. And a wrong score loses trust permanently, where "I couldn't
   hear that fairly" costs nothing. So the meter has to be willing to REFUSE.

   Three independent checks, because wind fails three different ways:
     1. CLARITY  - the detector's own confidence. Wind makes it guess.
     2. VOICED % - wind masks the fundamental, so frames stop resolving at all.
     3. RUMBLE   - wind is overwhelmingly sub-100 Hz energy. A hum is not.        */
/* ALWAYS SCORE IT — see the rule written out in hum-meter.html. Clarity, voiced% and
   rumble are kept as DIAGNOSTICS and reported, but none of them refuse on their own.
   The only thing that refuses is "nothing ever held a note", which is a statement of
   fact rather than a judgement about conditions. */
const WIND = { clarity: 0, voiced: 0, rumble: 99, holdMs: 400, gust: 0.55 };

/* WIND-INDUCED FALSE CRACKS — the failure the synthetic wind suite exposed, and the
   only one that produced a WRONG number rather than a refused one.

   `steady__wind-10mph-loud` scored 74.3 against a clean baseline of 99.6 — a 25-point
   error — while every gate metric looked healthy (mean rumble 0.36, clarity 0.90,
   voiced 0.99). A gust had landed mid-hum and manufactured a crack, and the crack cap
   then did the rest. Averages hide gusts by construction: wind is peaky, so the mean
   is dominated by the calm between them.

   Two things came out of measuring it:
     · Use the 90th PERCENTILE of rumble, not the mean. Clean audio tops out at 0.32;
       anything windy is 0.46+. The mean does not separate them.
     · Refuse NARROWLY. Heavy wind does not always break the score - a 25 mph gale
       still scored a clean hum 100. Refusing every windy recording would turn away a
       golfer on an ordinary breezy day, and they do not come back. So refuse only the
       case that is actually ambiguous: it was gusty AND the result contains a crack,
       which is precisely when a crack cannot be attributed to the golfer.            */
function gustSuspect(rumbleSeries, cracks){
  if(!rumbleSeries || !rumbleSeries.length || !cracks) return false;
  const r = [...rumbleSeries].sort((a,b)=>a-b);
  const p90 = r[Math.min(r.length-1, Math.round(0.90*(r.length-1)))];
  return p90 > WIND.gust;
}

function signalQuality(fr, rumbleRatio){
  const v = fr.filter(f=>f.hz);
  const voiced = fr.length ? v.length/fr.length : 0;
  const clarity = v.length ? v.reduce((s,f)=>s+(f.clarity||0),0)/Math.max(v.length,1) : 0;
  const rumble = rumbleRatio == null ? 0 : rumbleRatio;

  /* "DID IT EVER HOLD A NOTE?" — the check that separates a failing microphone from a
     real swing hum, and the two look far more alike than you would expect.

     First attempt was MEDIAN run length, and the wind test caught it immediately: it
     REFUSED a clean, genuine swing hum. Measured, a real swing hum's run distribution
     is [1,1,1,1,1,1,1,1,2,2,3,3,4,7,…] — median 80 ms — because a swing hum CRACKS,
     and the cracks are the thing we are here to measure. Rejecting a fragmented hum
     rejects exactly the golfers who need the number most.

     A flapping mic is [1,1,1,1,1,…] and nothing else: median 40 ms, and crucially a
     LONGEST run of 40 ms. It never sustains anything.

     So the question is not "is it fragmented" - a real swing hum IS fragmented. It is
     "did it EVER hold a note?" One continuous stretch of 400 ms anywhere is enough to
     say a voice was there; no such stretch means the microphone was failing.          */
  const runs = [];
  let n = 0;
  for(let i=0;i<fr.length;i++){
    if(fr[i].hz) n++;
    else if(n){ runs.push(n); n=0; }
  }
  if(n) runs.push(n);
  const longestMs = runs.length ? Math.max(...runs) * HOP : 0;

  const fails = [];
  if(clarity < WIND.clarity)  fails.push('clarity');
  if(voiced  < WIND.voiced)   fails.push('voiced');
  if(rumble  > WIND.rumble)   fails.push('rumble');
  if(longestMs < WIND.holdMs) fails.push('never-held-a-note');
  return { ok: fails.length === 0, clarity, voiced, rumble, longestMs, fails };
}

/* ── IMPACT ───────────────────────────────────────────────────────────────────
   A golf strike is a sharp BROADBAND transient - energy right across the spectrum
   in one frame. A hum is the opposite: narrow, harmonic, and it ramps. So impact
   is a sudden jump in HIGH-band energy the pitch track cannot explain.

   ⚠️ Impact is a LANDMARK INSIDE the hum, never the end of it. Brixton, 2026-08-18:
   "you hum in your backswing, then you hit the ball, then you hum in your follow-
   through. Sometimes it WILL stop at impact though - that's where your hum gets
   restricted." Ending the window at impact deletes the most diagnostic moment in
   the swing.                                                                     */
function findImpact(hi){
  if(!hi || hi.length < 6) return null;
  let best=-1, bestR=0;
  for(let i=3;i<hi.length-1;i++){
    const before=(hi[i-3]+hi[i-2]+hi[i-1])/3;
    const r = before>1e-6 ? hi[i]/before : 0;
    if(r>bestR){ bestR=r; best=i; }
  }
  return (bestR>=6 && best>0) ? {frame:best, ratio:bestR} : null;
}

/* Did the hum survive the strike? The headline for a swing hum: the whole claim is
   that a golfer who stays loose keeps the sound going THROUGH the ball.          */
function throughImpact(fr, impactFrame, windowMs){
  if(impactFrame == null) return null;
  const w = Math.max(2, Math.round((windowMs||400)/HOP));

  /* ⚠️ THE END OF THE RECORDING IS NOT A STOP AT THE BALL.
     Brixton, 2026-08-20: "If I got an elite hum why is it saying stopped at the ball?
     That makes no sense." He was right and this is why. The verdict was the share of
     VOICED frames in the 400 ms after the strike - but when the strike lands near the end
     of the hum there are no 400 ms left, so the window ran off the end of the recording
     and counted the empty tail as him going quiet. A hum with zero cracks and 100% on-air
     was told it stopped at the ball, which is the one verdict in the whole app that
     contradicts the score next to it.

     Same doctrine the crack logic already settled on: a fade at the end is only a break
     if he PICKED IT BACK UP. If there is not a full window of hum left to judge, the
     honest answer is that we did not hear the strike well enough to say - not an
     accusation. Reported as "no strike heard". */
  if(impactFrame + w > fr.length) return null;

  const after  = fr.slice(impactFrame, impactFrame+w);
  const before = fr.slice(Math.max(0,impactFrame-w), impactFrame);
  const aOn = after.filter(f=>f.hz).length  / Math.max(after.length,1);
  const bOn = before.filter(f=>f.hz).length / Math.max(before.length,1);
  return { after:aOn, before:bOn, survived:aOn>=0.5, restrictedAt:(aOn<0.5 && bOn>=0.5) };
}


/* ── THE REGISTER GUARD ───────────────────────────────────────────────────────
   Autocorrelation's function peaks at EVERY multiple of the pitch period, so half the
   true frequency is always a legal answer and only a margin rejects it. A reflection
   arriving near HALF the pitch period eats that margin - and a phone lying on the ground
   with a golfer standing six feet back is exactly that reflection, about three feet of
   extra path. Reproduced from his own recordings in octave-sim.js: D3 149.1 -> D#2 76.9,
   E3 166.3 -> G2 100.6. The database holds a real G2 96.7 from that same setup.

   COST OF GETTING IT WRONG: 11 of his 56 hums were graded on the phantom note and NOT ONE
   cleared 65.3. A confident wrong low score is the single worst thing this toy can do to
   a stranger, so a note we cannot trust must not be scored at all.

   TWO CHECKS, because a first-time visitor has no history:
     ① THE FLOOR - measured, not guessed. Across all 84 recordings in the project (his
       hums, strangers, IG golfers, range audio) the lowest TRUE note is 103.3 Hz. Below
       95 Hz nothing real has ever appeared, and 10 of the 11 known failures sit there.
     ② THE PLAYER'S OWN REGISTER - nobody drops a tritone below their own median between
       one hum and the next. Swept over all 56 database rows: 12 hums of history at 450
       cents catches 11/11 with ZERO false flags (at 5 hums it false-flags 3, at 8 one).

   This is a SAFETY NET. It stops the wrong score; it does not recover the right note.  */
const REGISTER_FLOOR_HZ = 95;
const REGISTER_HISTORY   = 12;
const REGISTER_BELOW_C   = 450;
function registerGuard(noteHz, history){
  if(!noteHz) return { trusted:true, why:null };
  if(noteHz < REGISTER_FLOOR_HZ)
    return { trusted:false, why:'below-floor', noteHz };
  const h = (history||[]).filter(v => v > 0);
  if(h.length >= REGISTER_HISTORY){
    const med = median(h);
    const below = -1200*Math.log2(noteHz/med);
    if(below > REGISTER_BELOW_C)
      return { trusted:false, why:'below-register', noteHz, median:med, below };
  }
  return { trusted:true, why:null };
}

window.HUM = { setFrames, getFrames, HOP, SR_MIN, SR_MAX, VIEW_CENTS, NOTE_NAMES,
               TOL_CENTS, CRACK_CAP, CAL, CLARITY_GATE, CLARITY_FILTERED,
               median, sd, detect, noteOf, robustNote, foldOctave, foldRun, anchorNote, lockNote, onNote, TUNE_FLOOR_HZ, confirmNoteOctave,
               resolveOctaves, deHash, isolate, score, beats,
               signalQuality, gustSuspect, findImpact, throughImpact, WIND,
               registerGuard, REGISTER_FLOOR_HZ, REGISTER_HISTORY, REGISTER_BELOW_C };

