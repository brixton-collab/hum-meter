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
const CLARITY_MIN = 0.55;             // below this the frame isn't a tone
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
const CRACK_CAP = 74.9, CRACK_JUMP_C = 100, CRACK_JUMP_MS = 50,
      CRACK_DROP_MS = 100, CRACK_TAIL_MS = 150;
const ISO_NEAR_C = 150, ISO_ON_FRAC = 0.40, ISO_MAX_GAP_MS = 1200, ISO_MIN_MS = 700;
const median=a=>{ const s=[...a].sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };
const sd=a=>{ if(a.length<2) return 0; const m=a.reduce((x,y)=>x+y,0)/a.length;
  return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length); };

function detect(buf, sr, floor){
  // remove DC, check we have signal at all
  let mean=0; for(let i=0;i<buf.length;i++) mean+=buf[i]; mean/=buf.length;
  let rms=0; for(let i=0;i<buf.length;i++){ buf[i]-=mean; rms+=buf[i]*buf[i]; }
  rms=Math.sqrt(rms/buf.length);
  if(rms<0.008) return null;                      // silence

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
  if(best<0 || bestV<CLARITY_MIN) return null;

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
    const resumesOnNote = on.length>=5 && median(on.slice(0,60).map(f=>off(f.hz))) <= ISO_NEAR_C;
    const stays = nxt.length && (nxt.filter(f=>f.hz && off(f.hz)<=200).length/nxt.length) >= ISO_ON_FRAC;
    if(b-a<=maxGap && resumesOnNote && stays){ end=b; continue; }
    break;
  }
  const tail = idx.filter(i=>i>=end);
  if(tail.length){ let j=0; while(j<tail.length-1 && tail[j+1]-tail[j]<=1) j++; end=tail[j]; }
  if((end-start)*HOP < ISO_MIN_MS) return [0, fr.length];
  return [start, end+1];
}
function score(){
  const [i0,i1] = isolate(frames);
  const hum = frames.slice(i0,i1);
  const first = hum.findIndex(f=>f.hz), last = hum.length-1-[...hum].reverse().findIndex(f=>f.hz);
  if(first < 0 || last-first < 20) return null;
  const span = hum.slice(first, last+1);              // trim lead-in / tail silence
  const voiced = span.map(f=>!!f.hz);
  const vh = span.filter(f=>f.hz).map(f=>f.hz);
  if(vh.length < 15) return null;

  const note = median(vh);
  const cents = vh.map(h=>1200*Math.log2(h/note));
  const k = Math.max(1, Math.round(TREND_MS/HOP/2));
  const path = cents.map((_,i)=>median(cents.slice(Math.max(0,i-k), i+k+1)));
  const dev  = cents.map((c,i)=>Math.abs(c-path[i]));

  // dev laid back onto the full span, so a dropout and a spike are the same axis
  const devSpan = new Array(span.length).fill(null);
  let vi=0; for(let i=0;i<span.length;i++) if(voiced[i]) devSpan[i]=dev[vi++];

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
  const guard = span.length - Math.round(CRACK_TAIL_MS/HOP);
  const cracks=[];
  for(let i=0;i<span.length;){
    if(devSpan[i]!==null && devSpan[i]>CRACK_JUMP_C){
      let j=i, mx=0;
      while(j<span.length && devSpan[j]!==null && devSpan[j]>CRACK_JUMP_C){ mx=Math.max(mx,devSpan[j]); j++; }
      if((j-i)*HOP>=CRACK_JUMP_MS && i<guard)
        cracks.push({kind:'jump', at:(i*HOP)/1000, ms:Math.round((j-i)*HOP), cents:Math.round(mx)});
      i=j;
    } else if(!voiced[i]){
      let j=i; while(j<span.length && !voiced[j]) j++;
      if((j-i)*HOP>=CRACK_DROP_MS && i>3 && i<guard)
        cracks.push({kind:'drop', at:(i*HOP)/1000, ms:Math.round((j-i)*HOP), cents:0});
      i=j;
    } else i++;
  }
  // THE CRACK RULE, and the fix to it.
  // Brixton: "if the hum cracks, the score has to be definitely below 75."
  // A flat ceiling did that — and piled every cracked hum onto exactly 74.9, so a badly
  // lost hum and a mildly cracked one read the same number. Useless to a golfer trying to
  // improve. So the ceiling COMPRESSES instead of clipping: a cracked hum is scaled into
  // 0..74.9 by how good it otherwise was. Ordering is preserved, the rule is honoured,
  // and the range below 75 is actually used.
  const capped = cracks.length > 0 && total > CRACK_CAP;
  const finalTotal = cracks.length ? total * (CRACK_CAP/100) : total;

  const tilt = den ? (num/den)*(n-1) : 0;
  // (f.clarity||0): deHash can turn a previously-unvoiced frame voiced, and those frames
  // were pushed without a clarity value. One undefined turns the whole average into NaN,
  // which is what put "NaN" on screen where a percentage should be.
  const clar = span.filter(f=>f.hz).reduce((s,f)=>s+(f.clarity||0),0)/Math.max(vh.length,1);
  return { total: Math.round(finalTotal*10)/10, line, onAir, tension, tilt, note, cracks, capped,
           humStart: i0+first, humWindow: [i0*HOP/1000, i1*HOP/1000],
           jitter: median(dev)*1.4826, held:(vh.length*HOP)/1000,
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
  const after  = fr.slice(impactFrame, impactFrame+w);
  const before = fr.slice(Math.max(0,impactFrame-w), impactFrame);
  const aOn = after.filter(f=>f.hz).length  / Math.max(after.length,1);
  const bOn = before.filter(f=>f.hz).length / Math.max(before.length,1);
  return { after:aOn, before:bOn, survived:aOn>=0.5, restrictedAt:(aOn<0.5 && bOn>=0.5) };
}

window.HUM = { setFrames, getFrames, HOP, SR_MIN, SR_MAX, VIEW_CENTS, NOTE_NAMES,
               TOL_CENTS, CRACK_CAP, CAL, CLARITY_GATE,
               median, sd, detect, noteOf, robustNote, confirmNoteOctave,
               resolveOctaves, deHash, isolate, score, beats,
               signalQuality, gustSuspect, findImpact, throughImpact, WIND };

