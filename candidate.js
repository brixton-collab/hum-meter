/* ─────────────────────────────────────────────────────────────────────────────
   THE CANDIDATE PIPELINE — harmonic note lock + trusted on-note gate + a gap
   discriminator that can tell "we lost him" from "he stopped at the ball".

   Nothing here ships until it clears every suite. Built as a module so the same code
   is measured against his anchors, the noise bed, the distance rig and his REAL
   six-foot recording before it goes anywhere near the page.
   ───────────────────────────────────────────────────────────────────────────── */
const {harmonicNote, spectrum, magAt} = require('./harmonic.js');

function build(H, P){
  const HOP = H.HOP;
  const med = a => { const s=[...a].sort((x,y)=>x-y); return s.length?s[s.length>>1]:0; };

  /* 1. THE NOTE, from harmonics over a long window. Octave-folded before the median,
        because the estimates are correct-modulo-octave far more often than they are
        correct outright: on his real six-foot recording, 20 of 22 windows land on
        163-166, 328-332 (2x) or 81-82 (1/2x). Folding turns that into one answer. */
  function noteLock(pcm, sr){
    const LONG = 8192, step = Math.round(sr*HOP/1000)*4;
    const raw = [];
    for(let i=0; i+LONG<=pcm.length; i+=step){
      const r = harmonicNote(pcm.subarray(i,i+LONG), sr, LONG);
      if(r && r.hz) raw.push(r.hz);
    }
    if(raw.length < 3) return null;
    const seed = med(raw);
    const fold = h => { while(h>seed*1.5) h/=2; while(h<seed*0.67) h*=2; return h; };
    const folded = raw.map(fold);
    const note = med(folded);
    const agree = folded.filter(h=>Math.abs(1200*Math.log2(h/note))<120).length / folded.length;
    return { note, agree };
  }

  /* 2. IS HIS STACK STILL IN THE AIR? The discriminator every earlier attempt needed and
        did not have. Loudness cannot answer it - a golf strike is loud, which is why
        band energy forgave a hum stopping at impact and inflated SWING121 from 68 to 89.
        A strike is also BROADBAND, and carries no harmonic stack at his note. So asking
        for HIS stack specifically separates "we lost him in noise" from "he stopped". */
  /* ⚠️ THE WINDOW HERE MUST BE SHORT, and the first version got it backwards. At 4096
     samples (93 ms) the window straddling a 100 ms gap still contains hum from BOTH
     sides, so the stack always looks present and every gap is excused as ours - which is
     how REF3, the recording he graded "the hum is lost", came back 86.
     Searching for an unknown note needs fine frequency resolution. VERIFYING a note we
     already know does not: at 164 Hz the harmonics sit at 328, 492, 656 Hz, which a
     46 ms window separates easily. So use the short window and keep the time resolution,
     because time is the thing this question is actually about. */
  function stackTrack(pcm, sr, note){
    const MID = 2048, step = Math.round(sr*HOP/1000), out = [];
    for(let i=0; ; i++){
      const s = i*step - (MID>>1);
      if(i*step >= pcm.length) break;
      if(s < 0 || s+MID > pcm.length){ out.push(0); continue; }
      const mag = spectrum(pcm.subarray(s,s+MID), MID), binHz = sr/MID;
      let peak=0; for(let k=1;k<mag.length;k++) if(mag[k]>peak) peak=mag[k];
      let hits=0;
      for(let h=1;h<=6;h++){
        const f=note*h; if(f/binHz>=mag.length-2) break;
        const m=magAt(mag,f,binHz);
        let nb=0,nn=0;
        for(let d=4;d<=12;d++){ const l=Math.round(f/binHz)-d, r=Math.round(f/binHz)+d;
          if(l>0){nb+=mag[l];nn++;} if(r<mag.length){nb+=mag[r];nn++;} }
        if(m>peak/40 && m>(nn?nb/nn:0)*1.8) hits++;
      }
      out.push(hits);
    }
    return out;
  }

  /* self-consistency: a track that found the hum is coherent, because a hum is one note */
  function coherence(fr){
    const v = fr.filter(f=>f.hz).map(f=>f.hz);
    if(v.length < 10) return 0;
    const m = med(v);
    const agree = v.filter(h=>Math.abs(1200*Math.log2(h/m))<200).length / v.length;
    return (v.length/fr.length) * agree * agree;
  }
  function track(band, sr){
    const step=Math.round(sr*HOP/1000), W=2048, fr=[];
    for(let i=0;i+W<=band.length;i+=step){
      const d=H.detect(Float32Array.from(band.subarray(i,i+W)), sr, H.SR_MIN, H.CLARITY_FILTERED);
      fr.push({hz:d?d.hz:0, clarity:d?d.clarity:0});
    }
    return fr;
  }

  const ON_NOTE_C = 250;
  function run(pcm, sr){
    const wide = track(P.wideBand(pcm,sr), sr);
    const lock = noteLock(pcm, sr);
    let fr = wide, note = null;
    if(lock){
      const tight = track(P.tightBand(pcm,sr,lock.note), sr);
      /* NEVER COMMIT BLINDLY. A wrong lock centres the band off the voice and REMOVES the
         hum instead of finding it - the same trap as the live retune. With no ground
         truth at run time, self-consistency decides. */
      if(coherence(tight) > coherence(wide)){ fr = tight; note = lock.note; }
      else if(lock.agree > 0.6) note = lock.note;      // trust the note, keep the wide track
    }
    if(!note){ const v=fr.filter(f=>f.hz).map(f=>f.hz); note = v.length?H.anchorNote(v):0; }
    if(!note) return null;

    // fold octaves onto the trusted note, then gate what is nowhere near it
    fr.forEach(f=>{ if(f.hz) f.hz = H.foldOctave(f.hz, note); });
    fr.forEach(f=>{ if(f.hz && Math.abs(1200*Math.log2(f.hz/note)) > ON_NOTE_C) f.hz = 0; });

    const stack = stackTrack(pcm, sr, note);
    return { fr, note, stack };
  }
  return { run, noteLock, stackTrack, coherence };
}
module.exports = { build };
