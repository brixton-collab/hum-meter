/* ── LONG-WINDOW HARMONIC NOTE TRACKER ────────────────────────────────────────
   A hum is a harmonic stack. Road noise is not. So score every candidate note by the
   energy sitting on ALL of its harmonics and let harmonics 2..8 carry the vote when the
   fundamental is buried - which is exactly what distance and rumble do to it.

   The window is LONG (186 ms) on purpose. The first attempt used the 46 ms analysis
   window and failed at 1% usable even with his mouth on the phone, for a reason the
   arithmetic gives instantly: 46 ms is 21.5 Hz per FFT bin, and a 115 Hz hum sits at bin
   5.3, so neighbouring notes land on the SAME bins. 186 ms is 5.4 Hz per bin.

   Long windows blur time, which is why this only finds the NOTE - a thing that barely
   moves across a hum. Per-frame pitch is still measured at 40 ms, by autocorrelation on
   a band centred on the note this finds. Robust WHERE from harmonics, precise WHEN from
   time domain.                                                                          */
function fft(re,im){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit;
    if(i<j){ const tr=re[i];re[i]=re[j];re[j]=tr; const ti=im[i];im[i]=im[j];im[j]=ti; } }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len, wr0=Math.cos(ang), wi0=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let wr=1, wi=0;
      for(let k=0;k<len/2;k++){
        const ur=re[i+k], ui=im[i+k];
        const vr=re[i+k+len/2]*wr - im[i+k+len/2]*wi;
        const vi=re[i+k+len/2]*wi + im[i+k+len/2]*wr;
        re[i+k]=ur+vr; im[i+k]=ui+vi;
        re[i+k+len/2]=ur-vr; im[i+k+len/2]=ui-vi;
        const nwr=wr*wr0-wi*wi0; wi=wr*wi0+wi*wr0; wr=nwr;
      }
    }
  }
}
const F0MIN=70, F0MAX=400, NH=8;
function spectrum(buf, N){
  const re=new Float64Array(N), im=new Float64Array(N);
  let mean=0; for(let i=0;i<buf.length && i<N;i++) mean+=buf[i]; mean/=Math.min(N,buf.length);
  for(let i=0;i<N;i++){
    const v = i<buf.length ? buf[i]-mean : 0;
    re[i]= v*(0.5-0.5*Math.cos(2*Math.PI*i/N));      // Hann
  }
  fft(re,im);
  const half=N>>1, mag=new Float64Array(half);
  for(let i=0;i<half;i++) mag[i]=Math.hypot(re[i],im[i]);
  return mag;
}
/* interpolated magnitude at an arbitrary frequency */
function magAt(mag, f, binHz){
  const b=f/binHz; const i=Math.floor(b); const t=b-i;
  if(i<1||i+1>=mag.length) return 0;
  return mag[i]*(1-t)+mag[i+1]*t;
}
function harmonicNote(buf, sr, N){
  const mag=spectrum(buf,N), binHz=sr/N, half=mag.length;
  let total=0; for(let i=1;i<half;i++) total+=mag[i];
  if(!total) return null;

  /* A FLOOR, so "is this harmonic actually there?" is a real question. Without it the
     score is pure addition and a candidate can win by predicting harmonics that do not
     exist. */
  /* ⚠️ THE FLOOR MUST BE RELATIVE TO THE LOUDEST THING IN THE SPECTRUM, not a percentile
     of it. A percentile of a mostly-empty spectrum lands below the FFT's own leakage, so
     every harmonic reads "present", the missing-harmonic penalty never fires, and the
     whole octave argument collapses - measured, a 115 Hz hum with no fundamental scored
     all eight harmonics present and lost to its own octave by 1.5%. Peak/40 is about
     -32 dB, which is comfortably above leakage and below any harmonic that is really
     there. */
  const lo=Math.max(1,Math.floor(F0MIN/binHz)), hi=Math.min(half-2,Math.floor(F0MAX*NH/binHz));
  let peak=0; for(let i=lo;i<=hi;i++) if(mag[i]>peak) peak=mag[i];
  const floor = peak/40;

  /* ⚠️ THE SCORE HAS TO PUNISH ABSENCE, NOT JUST REWARD PRESENCE - it is the whole
     difference between finding his note and finding half of it.

     A plain harmonic sum is biased LOW by construction: every harmonic of f is also a
     harmonic of f/2, so the subharmonic always scores at least as well and the detector
     answers an octave down. Promoting the winner instead - "take the higher candidate if
     it holds up" - breaks the opposite case, which is the one distance actually creates:
     when the fundamental is buried and only 2f0, 3f0, 4f0 survive, promotion answers
     2f0. Measured on a synthetic hum with the fundamental removed entirely: it returned
     231 Hz for a 115 Hz note, an octave out.

     Both errors are the same mistake - scoring only what IS there. A candidate an octave
     LOW predicts harmonics at f/2, 3f/2, 5f/2 which are simply absent, and a candidate an
     octave HIGH explains fewer of the peaks that exist. So count both: add the energy
     found, subtract for every harmonic predicted and missing. Then among everything that
     scores nearly as well, take the LOWEST - because a missing fundamental is still the
     note, and 2f0 only ever explains a subset of what f0 explains.                      */
  const evalF=f=>{
    let found=0, missing=0, present=0, n=0;
    for(let h=1;h<=NH;h++){
      const fh=f*h; if(fh/binHz>=half-2) break;
      n++;
      const m=magAt(mag,fh,binHz);
      /* ⚠️ A HARMONIC IS A PEAK, NOT JUST A LOUD BIN. Road noise and wind are broadband:
         they raise everything at once, so "above the floor" is satisfied everywhere and
         a candidate can score well by pointing its whole stack into noise. Measured, that
         is exactly how the detector answered 70 Hz - the very bottom of the range - for a
         138 Hz hum under brown noise: brown noise is loudest at the bottom, so the lowest
         candidate always won. A tone stands ABOVE its neighbours; noise does not. */
      let nb=0, nn=0;
      for(let d=4;d<=12;d++){
        const l=Math.round(fh/binHz)-d, r=Math.round(fh/binHz)+d;
        if(l>0){ nb+=mag[l]; nn++; }
        if(r<half){ nb+=mag[r]; nn++; }
      }
      const local = nn ? nb/nn : 0;
      if(m>floor && m > local*1.8){ found += m/Math.sqrt(h); present++; }
      /* ⚠️ A MISSING FUNDAMENTAL IS NOT EVIDENCE AGAINST THE NOTE - it is the normal
         state of a hum heard from six feet away, and of a phone mic that rolls off at
         the bottom. Penalising h=1 is what made the detector answer 2f0 on a hum whose
         fundamental had been removed. Missing SECOND and THIRD harmonics are a different
         matter: no real voice omits those, so their absence really does argue the
         candidate is wrong. So the penalty starts at h=2. */
      else if(h>=2) missing += 1/Math.sqrt(h);   // h=1 exempt: see above
    }
    if(!n) return {s:0, present:0};
    return {s: found - missing*floor*2.5, present};
  };
  /* a candidate has to actually be a harmonic stack, not one loud bin in some noise */
  const score=f=>{ const r=evalF(f); return r.present>=3 ? r.s : -Infinity; };
  let best=0,bestS=-Infinity;
  for(let f=F0MIN; f<=F0MAX; f+=0.5){ const s=score(f); if(s>bestS){bestS=s;best=f;} }
  if(!best || bestS<=0) return null;

  /* Among candidates that explain the spectrum nearly as well, prefer the LOWEST - a
     missing fundamental is still the note, and 2f0 only ever explains a subset of what
     f0 explains. The bar is deliberately high: in heavy noise a loose bar let the very
     bottom of the range win on broadband energy alone, and the detector answered 70 Hz. */
  for(let f=F0MIN; f<best-1; f+=0.5){
    const s=score(f);
    if(s >= bestS*0.985 && s > 0){ best=f; bestS=s; break; }
  }
  // refine on the harmonic-sum curve, guarded so the parabola cannot run away
  const d=0.25;
  const a=score(best-d), b2=score(best), c2=score(best+d), den=a-2*b2+c2;
  let f0=best;
  if(den < 0){ const sh=0.5*(a-c2)/den; if(Math.abs(sh)<=1) f0 = best + d*sh; }
  if(!isFinite(f0) || f0<F0MIN || f0>F0MAX) f0=best;
  return { hz:f0, strength: bestS/total };
}
module.exports={fft, spectrum, harmonicNote, magAt};

if(require.main===module){
  /* ── SANITY: does it find a note we already know? ── */
  const sr=44100, N=8192;
  let pass=0, fail=0;
  const ok=(n,c,d='')=>{c?(pass++,console.log('  ✅ '+n+'  '+d)):(fail++,console.log('  ❌ '+n+'  '+d));};
  console.log('\n── the detector must find a note it is GIVEN before it is trusted on his ──');
  for(const f0 of [95, 115.2, 138, 155.6, 220]){
    const buf=new Float32Array(N);
    for(let i=0;i<N;i++){ const t=i/sr;
      buf[i]=0.5*Math.sin(2*Math.PI*f0*t)+0.3*Math.sin(2*Math.PI*2*f0*t)+0.15*Math.sin(2*Math.PI*3*f0*t); }
    const r=harmonicNote(buf,sr,N);
    const err=r?Math.abs(1200*Math.log2(r.hz/f0)):999;
    ok(`clean ${f0} Hz`, err<15, r?`found ${r.hz.toFixed(1)} (${err.toFixed(0)}c off)`:'nothing');
  }
  console.log('\n── and with the fundamental REMOVED, which is what distance does ──');
  for(const f0 of [115.2, 138]){
    const buf=new Float32Array(N);
    for(let i=0;i<N;i++){ const t=i/sr;   // NO fundamental at all - harmonics only
      buf[i]=0.35*Math.sin(2*Math.PI*2*f0*t)+0.2*Math.sin(2*Math.PI*3*f0*t)+0.1*Math.sin(2*Math.PI*4*f0*t); }
    const r=harmonicNote(buf,sr,N);
    const err=r?Math.abs(1200*Math.log2(r.hz/f0)):999;
    ok(`${f0} Hz with NO fundamental`, err<15, r?`found ${r.hz.toFixed(1)} (${err.toFixed(0)}c off)`:'nothing');
  }
  console.log('\n── buried in brown noise 3x louder than the hum ──');
  for(const f0 of [115.2, 138]){
    const buf=new Float32Array(N); let y=0;
    for(let i=0;i<N;i++){ const t=i/sr;
      y=0.995*y+0.05*(Math.random()*2-1);
      buf[i]=0.15*(Math.sin(2*Math.PI*f0*t)+0.7*Math.sin(2*Math.PI*2*f0*t)+0.3*Math.sin(2*Math.PI*3*f0*t))+y*3; }
    const r=harmonicNote(buf,sr,N);
    const err=r?Math.abs(1200*Math.log2(r.hz/f0)):999;
    ok(`${f0} Hz under heavy noise`, err<25, r?`found ${r.hz.toFixed(1)} (${err.toFixed(0)}c off)`:'nothing');
  }
  console.log(`\n${fail===0?'✅ ALL PASS':'❌ FAILURES'}   ${pass} passed, ${fail} failed\n`);
}
