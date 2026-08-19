/* The candidate scorer: same maths as the shipping one, plus the gap discriminator. */
function build(H){
  const HOP=H.HOP, TOL=25;
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?(s.length%2?s[s.length>>1]:(s[(s.length>>1)-1]+s[s.length>>1])/2):0;};
  return function score(fr, stack, opts){
    opts=opts||{};
    const STACK_MIN = opts.stackMin==null ? 2 : opts.stackMin;
    const first=fr.findIndex(f=>f.hz), last=fr.length-1-[...fr].reverse().findIndex(f=>f.hz);
    if(first<0||last-first<20) return null;
    const span=fr.slice(first,last+1);
    const voiced=span.map(f=>!!f.hz), vh=span.filter(f=>f.hz).map(f=>f.hz);
    if(vh.length<15) return null;
    const note=med(vh), cents=vh.map(h=>1200*Math.log2(h/note));
    const k=Math.max(1,Math.round(200/HOP/2));
    const path=cents.map((_,i)=>med(cents.slice(Math.max(0,i-k),i+k+1)));
    const dev=cents.map((c,i)=>Math.abs(c-path[i]));
    const devSpan=new Array(span.length).fill(null);
    let vi=0; for(let i=0;i<span.length;i++) if(voiced[i]) devSpan[i]=dev[vi++];

    /* ── WHOSE GAP IS IT? ──────────────────────────────────────────────────────
       For every unvoiced run, ask whether HIS HARMONIC STACK is still in the air.
         stack present -> we lost him in the noise. Not his. Not scored, not a crack.
         stack absent  -> his voice actually stopped. His. Counted, and a crack.
       Loudness cannot make this call: a golf strike is loud, so band energy forgave a
       hum stopping at impact and inflated SWING121 from 68 to 89. A strike is BROADBAND
       and carries no stack at his note, so asking for HIS stack answers correctly. */
    const measurable=new Array(span.length).fill(true);
    const ourGap=new Array(span.length).fill(false);
    for(let i=0;i<span.length;){
      if(voiced[i]){ i++; continue; }
      let j=i; while(j<span.length && !voiced[j]) j++;
      let present=0,n=0;
      for(let q=i;q<j;q++){ const s=stack?stack[first+q]:null; if(s!=null){ present+=s>=STACK_MIN?1:0; n++; } }
      const ours = n ? (present/n) >= 0.5 : false;
      if(ours) for(let q=i;q<j;q++){ measurable[q]=false; ourGap[q]=true; }
      i=j;
    }
    const onLine=devSpan.map(d=>d!==null&&d<=TOL);
    const denom=Math.max(1,measurable.filter(Boolean).length);
    const total=onLine.filter(Boolean).length/denom*100;

    const guard=span.length-Math.round(150/HOP), head=Math.round(150/HOP);
    const cracks=[];
    for(let i=0;i<span.length;){
      if(devSpan[i]!==null&&devSpan[i]>100){
        let j=i,mx=0; while(j<span.length&&devSpan[j]!==null&&devSpan[j]>100){mx=Math.max(mx,devSpan[j]);j++;}
        if((j-i)*HOP>=100 && i<guard && i>=head)
          cracks.push({kind:'jump',at:(i*HOP)/1000,ms:Math.round((j-i)*HOP)});
        i=j;
      } else if(!voiced[i]){
        let j=i; while(j<span.length&&!voiced[j]) j++;
        if(!ourGap[i] && (j-i)*HOP>=100 && i>=head && i<guard)
          cracks.push({kind:'drop',at:(i*HOP)/1000,ms:Math.round((j-i)*HOP)});
        i=j;
      } else i++;
    }
    const shape=Math.pow(Math.max(0,total)/100,0.55);
    const rep=1-Math.min(0.30,Math.max(0,cracks.length-1)*0.03);
    const fin=cracks.length?Math.min(total,74.9*shape*rep):total;
    return { total:Math.round(fin*10)/10, raw:Math.round(total*10)/10,
             cracks:cracks.length, ourGaps:ourGap.filter(Boolean).length, note };
  };
}
module.exports={build};
