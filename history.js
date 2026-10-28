// Farrell Flow — "Last 5 days": 5 prior completed sessions + today (live) once in-session data exists.
const HS={mode:"net",focus:null,charts:[]};
function hatch(color){const c=document.createElement("canvas");c.width=c.height=8;const g=c.getContext("2d");
  g.fillStyle=color.replace(/[\d.]+\)$/,".18)");g.fillRect(0,0,8,8);g.strokeStyle=color;g.lineWidth=2;g.beginPath();g.moveTo(0,8);g.lineTo(8,0);g.moveTo(-2,2);g.lineTo(2,-2);g.moveTo(6,10);g.lineTo(10,6);g.stroke();
  return g.createPattern(c,"repeat")}
function hSeries(t){const P=D.daily;if(!P)return null;
  return P.dates.map(d=>{const live=d===P.today,lab=live?"Today (live)":new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"numeric",day:"numeric"});
    if(HS.mode==="net"){const r=(P.inferred[d]||{}).t?.[t];return{d,lab,live,v:r?r.net:null,r,src:r?"inferred":null}}
    let c=null,p=null,src=null;
    if(live){const x=tick(t);if(x&&x.call_vol!=null){c=x.call_vol;p=x.put_vol;src="Yahoo session volume (live, partial)"}}
    else{const o=(P.occ_cp[d]||{})[t];if(o){[c,p]=o;src="OCC cleared volume"}}
    return{d,lab,live,v:c==null?null:c-p,c,p,src}})}
function hChart(el,t,big){const S=hSeries(t);if(!S)return;let cum=0;const cl=S.map(s=>s.v==null?null:(cum+=s.v));
  const net=HS.mode==="net",fmt=v=>net?sgn(v):(v>0?"+":"")+n(v);
  const colr=s=>s.v==null?"rgba(0,0,0,0)":s.v>=0?"rgba(34,197,94,.85)":"rgba(239,68,68,.85)";
  const ds=[{type:"bar",label:net?"Net premium":"Calls − puts",data:S.map(s=>s.v),order:2,
      backgroundColor:S.map(s=>s.live&&s.v!=null?hatch(colr(s)):colr(s)),borderColor:S.map(s=>s.live?"#e6e9f0":"transparent"),borderWidth:S.map(s=>s.live?1.5:0)},
    {type:"line",label:`${S.length}-day cumulative`,data:cl,order:1,borderColor:"#ffd166",backgroundColor:"#ffd166",pointRadius:big?3:1.5,borderWidth:big?2:1.3,spanGaps:true,tension:.2}];
  const ch=new Chart(el,{data:{labels:S.map(s=>s.lab),datasets:ds},options:{responsive:true,maintainAspectRatio:false,animation:false,
    scales:{x:{ticks:{color:c=>S[c.index]&&S[c.index].live?"#fff":"#8a93a6",font:{size:big?11:9},maxRotation:0,autoSkip:false,callback:(v,i)=>big?S[i].lab:S[i].lab.split(" ")[0].replace("Today","Live")},grid:{display:false}},
      y:{display:big,ticks:{color:"#8a93a6",callback:fmt},grid:{color:c=>c.tick.value===0?"#9aa3b5":"#1f2635"}}},
    plugins:{legend:{display:big,labels:{color:"#c9d3ea",boxWidth:10}},
      tooltip:{callbacks:{title:it=>S[it[0].dataIndex].lab+(S[it[0].dataIndex].live?" — updates each snapshot":""),
        label:c=>{const s=S[c.dataIndex];if(c.datasetIndex===1)return`${S.length}-day cumulative: ${c.raw==null?"–":fmt(c.raw)}`;
          if(s.v==null)return net?"No inferred-side data for this day (inferred flow starts Oct 28)":"No volume data";
          return net?[`Net ${sgn(s.v)}`,`Bullish $${money(s.r.bull)} · Bearish $${money(s.r.bear)}`,`P/C vol ${s.r.pc??"–"}`+(s.r.vol_ratio!=null?` · vol ${s.r.vol_ratio}x 20d avg`:"")]
            :[`Calls ${n(s.c)} · Puts ${n(s.p)} · P/C ${s.c?(s.p/s.c).toFixed(2):"–"}`,`Call − put ${fmt(s.v)}`,s.src]}}}},
    onClick:()=>{if(!big){HS.focus=t;hDraw()}}}});
  HS.charts.push(ch);return S}
// ---------- scoreboard heatmap (comparable across tickers) ----------
function hNorm(t){const P=D.daily;return P.dates.map(d=>{const live=d===P.today;
  // inferred net ÷ directional premium; today uses the live snapshot = exactly the Net flow card's numbers
  let r=(P.inferred[d]||{}).t?.[t];if(live){const x=tick(t),f=x&&x.flow_sentiment;if(x&&f&&x.side_source!=="unavailable")r={bull:f.bull_premium||0,bear:f.bear_premium||0,net:(f.bull_premium||0)-(f.bear_premium||0)}}
  const tot=r?(r.bull+r.bear):0,np=r&&tot?r.net/tot*100:null;
  let c=null,p=null,src;if(live){const x=tick(t);if(x&&x.call_vol!=null){c=x.call_vol;p=x.put_vol;src="Yahoo session volume so far (live, partial)"}}
  else{const o=(P.occ_cp[d]||{})[t];if(o){[c,p]=o;src="OCC cleared volume"}}
  const b=((P.cs_base||{})[d]||{})[t],pp=c!=null&&c+p>0&&b?(c/(c+p)-b.share)*100:null;
  const k=dirConf(pp,np,r?r.net:0),npTip=np!=null?`Buy/sell flow: net ${sgn(r.net)} of $${money(tot)} directional premium (bull $${money(r.bull)} / bear $${money(r.bear)}) = ${(np>0?"+":"")+np.toFixed(1)}%`:"No inferred buy/sell side data for this day (starts Oct 28)";
  const ppTip=pp!=null?`Volume mix: call share ${(c/(c+p)*100).toFixed(1)}% vs 20-day avg ${(b.share*100).toFixed(1)}% (${b.days} sessions) = ${(pp>0?"+":"")+pp.toFixed(1)} pp\nCalls ${n(c)} · Puts ${n(p)} · ${src}`:(c==null?"No volume data":"Not enough history for a 20-day baseline");
  const tip=(HS.mode==="net"?npTip+"\n"+ppTip:ppTip+"\n"+npTip)+(k.conflict?"\n⚠ "+k.msg:"");
  if(HS.mode==="net"&&np==null&&pp!=null)   // no side recorded this day: show the volume mix, styled as a fallback (never as side data)
    return{d,live,v:null,fb:pp,tip:"Side data not recorded this day; volume mix shown (not buy/sell, not counted in the score).\n"+ppTip,k}
  return{d,live,v:HS.mode==="net"?np:pp,tip,k}})}
function hVol(v){const c=v>=0?"34,197,94":"239,68,68";return`background:repeating-linear-gradient(45deg,rgba(${c},.22) 0 4px,rgba(26,32,48,.9) 4px 8px)`}
function hCell(v,cap){if(v==null)return"";const a=(.15+.8*Math.sqrt(Math.min(1,Math.abs(v)/cap))).toFixed(2);return`background:${v>=0?`rgba(34,197,94,${a})`:`rgba(239,68,68,${a})`}`}
function hDraw(){HS.charts.forEach(c=>c.destroy());HS.charts=[];const P=D.daily,body=$("#hBody");
  if(!P||!P.dates.length){body.innerHTML='<div class="fc-msg">No daily history yet.</div>';$("#hChips").innerHTML="";return}
  document.querySelectorAll("#hMode button").forEach(b=>b.classList.toggle("on",b.dataset.v===HS.mode));
  const net=HS.mode==="net",cap=net?60:15,unit=net?"%":" pp",fmt=v=>v==null?"–":(v>0?"+":"")+v.toFixed(1);
  if(HS.focus){$("#hChips").innerHTML=`<button class="fc-back" id="hBack">← Back to scoreboard</button><span class="fc-focus">${HS.focus}${pos(HS.focus)}${er(HS.focus)} · ${net?"inferred net premium":"calls − puts (contracts)"} per day</span>`;
    $("#hBack").onclick=()=>{HS.focus=null;hDraw()};
    body.innerHTML=`<div class="h-big"><div class="h-cv"><canvas></canvas></div></div>`;hChart(body.querySelector("canvas"),HS.focus,true)}
  else{const tks=WATCH.filter(t=>tick(t));
    const rows=tks.map(t=>{const c=hNorm(t),vals=c.filter(x=>x.v!=null).map(x=>x.v);const score=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
      let trend=0;if(vals.length>=3){const l2=(vals.at(-1)+vals.at(-2))/2,pr=vals.slice(0,-2);const base=pr.reduce((a,b)=>a+b,0)/pr.length;const th=net?10:2;trend=l2-base>=th?1:l2-base<=-th?-1:0}
      return{t,c,score,n:vals.length,trend}}).sort((a,b)=>(b.score??-1e9)-(a.score??-1e9));
    const smax=Math.max(1e-9,...rows.map(r=>Math.abs(r.score||0)));
    const info=net?"Inferred net premium ÷ total directional premium (bullish + bearish) for each day: +100% = all bullish, −100% = all bearish. Comparable across tickers of any size. Side is inferred from delayed quotes; only exists from Oct 28 onward."
      :"Call share of options volume (calls ÷ (calls + puts)) minus that ticker's own 20-session average call share, in percentage points. +5 pp = 5 points more call-heavy than usual for that name. Completed days: OCC cleared volume; Today: Yahoo session volume so far. Volume-based: no side (a call can be bought or sold).";
    const ncf=rows.filter(r=>r.c.some(x=>x.k.conflict)).map(r=>r.t);
    const nside=P.dates.filter(d=>P.inferred[d]||d===P.today).length;
    const hcap=net?`<span class="h-cap"><b>What this shows:</b> side-based net flow — inferred buy/sell net premium ÷ directional premium, the same signal as the Net flow card (Today matches it exactly). ${nside<P.dates.length?`Side history started Oct 28, so older days show the call/put <i>volume mix</i> instead (dimmed, hatched, tagged <span class="voltag">vol</span>, not counted in the score) until it builds up — fully side-based after 5 sessions. `:""}⚠ = the call/put volume mix points the other way from the side flow.</span>`:`<span class="h-cap"><b>What this shows:</b> call vs put <i>volume mix</i> vs normal — not who bought or sold. The Net flow card shows buy/sell. ⚠ = the two disagree${ncf.length?" (now: "+ncf.join(", ")+")":""}; hover a cell for both numbers.</span>`;
    $("#hChips").innerHTML=hcap+`<span class="fc-hint">${net?"Side-based net ÷ directional premium (inferred buy/sell)":"Call share vs own 20-day average (volume-based, no side)"} <span class="hinfo" tabindex="0" data-tip="${info}">ⓘ</span> · sorted by score, most bullish on top · click a row for its 5-day chart</span>`;
    const hd=P.dates.map(d=>d===P.today?`<div class="sc-h live">Today<br><small>live</small></div>`:`<div class="sc-h">${new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"})}<br><small>${new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"numeric",day:"numeric"})}</small></div>`).join("");
    let h=`<div class="sc" style="grid-template-columns:minmax(84px,max-content) repeat(${P.dates.length},minmax(46px,1fr)) minmax(170px,1.6fr)"><div class="sc-h"></div>${hd}<div class="sc-h">Score <small>(${net?`avg of ${nside} side day${nside==1?"":"s"}`:`avg of ${P.dates.length} cols`})</small> <span class="hinfo" tabindex="0" data-tip="${net?"Average of the side-based (buy/sell) cells only, including today's live value; volume-mix fallback cells are not counted. Ranking is by this score.":"Average of the row's values across the columns shown (including today's live value)."} Arrow: ↗ the last 2 days are notably more bullish than the earlier days (≥${net?10:2}${unit.trim()}), ↘ notably more bearish.">ⓘ</span></div>`;
    rows.forEach(r=>{h+=`<div class="sc-row" data-t="${r.t}"><div class="sc-tk">${r.t}${pos(r.t)}${er(r.t).replace(/>📅 [^<]*</,">📅<")}${sq(r.t,1)}${(r.c.find(x=>x.live)||{}).k?.conflict?confMark(r.c.find(x=>x.live).k):""}</div>`+
      r.c.map((x,i)=>{const ed=erDate(r.t).find(z=>z.date===P.dates[i]);return`<div class="sc-cell ${x.live?"live":""} ${x.v==null&&x.fb==null?"nd":""} ${x.fb!=null?"vol":""} ${ed?"er":""}" style="${x.fb!=null?hVol(x.fb):hCell(x.v,cap)}" title="${(x.live?"Today (live) · ":"")+x.tip}${ed?` · Earnings date (${ed.e.timing||"timing n/a"}${ed.e.estimated===false?"":", unconfirmed"})`:""}">${x.fb!=null?fmt(x.fb)+'<span class="voltag">vol</span>':fmt(x.v)+confMark(x.k)}</div>`}).join("")+
      `<div class="sc-score"><span class="hm-bar"><i class="${(r.score||0)>=0?"up":"dn"}" style="${(r.score||0)>=0?"left:50%":"right:50%"};width:${r.score==null?0:Math.abs(r.score)/smax*50}%"></i></span><b class="${(r.score||0)>=0?"C":"P"}">${fmt(r.score)}${r.score==null?"":unit}</b><span class="tr ${r.trend>0?"C":r.trend<0?"P":""}" title="${r.trend>0?"Last 2 days more bullish than before":r.trend<0?"Last 2 days more bearish than before":""}">${r.trend>0?"↗":r.trend<0?"↘":""}</span></div></div>`});
    body.innerHTML=h+"</div>";
    body.querySelectorAll(".sc-row").forEach(e=>e.onclick=()=>{HS.focus=e.dataset.t;hDraw()})}
  const inf=P.dates.filter(d=>P.inferred[d]),occ=P.dates.filter(d=>P.occ_cp[d]);
  $("#hNote").innerHTML=net?`<b>Side-based net flow</b>: +100% = all bullish premium (calls bought at ask / puts sold at bid), −100% = all bearish. Side data exists from Oct 28 onward (${inf.length} of ${P.dates.length} days so far); each session's final totals are saved after the close, so past columns fill in day by day. Hatched <span class="voltag">vol</span> cells are the call/put volume mix (pp vs 20-day avg), shown only because side data wasn't recorded that day; they are not side data and not scored. Today is live and updates each snapshot.`
    :`<b>Volume-based (no side)</b>. Completed days: OCC cleared volume (${occ.length} days); ${P.today?"Today (outlined): Yahoo session volume so far, live and partial (~15 min delayed); ":""}baseline = each ticker's own volume-weighted call share over the 20 OCC sessions before that day. Shows call/put skew vs normal, not whether trades were bought or sold. Numbers are in every cell so color isn't the only cue.`}
document.querySelectorAll("#hMode button").forEach(b=>b.onclick=()=>{HS.mode=b.dataset.v;hDraw()});
