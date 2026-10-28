// Farrell Flow — intraday flow from pipeline snapshots (each column/point = one delayed snapshot; side inferred).
// Default: heatmap of net-premium change per interval ("when the flow came in"). Row click -> single-ticker line + interval bars.
const RAW_TS="https://raw.githubusercontent.com/bobbyfarrell20/options-flow-dashboard/main/data/timeseries/";
// High-contrast palette (Okabe-Ito first, then distinct extras) for the optional multi-line view.
const PAL=["#56B4E9","#E69F00","#F0E442","#CC79A7","#FFFFFF","#0072B2","#D55E00","#009E73","#B388FF","#FF6B9A","#7FDBFF","#C0C0C0","#FFB000","#8DD3C7","#FB8072","#BEBADA"];
const CH={view:"heat",scale:"row",sel:null,focus:null,norm:false,date:null,series:null,dates:[],win:null,chart:null,userSel:false};
const etHM=ms=>new Date(ms).toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit"});
const sgn=v=>(v>0?"+":v<0?"-":"")+money(Math.abs(v));
function colorOf(t){const tks=CH.series?WATCH.filter(x=>CH.series.points.some(p=>p.t[x])):WATCH;return PAL[Math.max(0,tks.indexOf(t))%PAL.length]}
function bounds(s){const p=s.points;if(!p.length)return null;const off=p[0].ts.slice(19)||"-04:00";
  return{open:Date.parse(s.date+"T09:30:00"+off),close:Date.parse(s.date+"T16:00:00"+off),first:Date.parse(p[0].ts),last:Date.parse(p[p.length-1].ts)}}
function perTicker(s){const out={};s.points.forEach(p=>{const x=Date.parse(p.ts);for(const[t,v]of Object.entries(p.t)){if(!WATCH.includes(t))continue;(out[t]=out[t]||[]).push({x,b:v[0],r:v[1],net:v[2],vol:v[3],cu:!!p.catchup})}});
  for(const a of Object.values(out))a.forEach((q,i)=>{q.d=i?q.net-a[i-1].net:q.net;q.first=!i;q.prev=i?a[i-1].x:null});return out}
async function getSession(date){const get=u=>fetch(u+"?ts="+Date.now(),{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null);
  const got=(await Promise.all([get("data/timeseries/"+date+".json"),get(RAW_TS+date+".json")])).filter(Boolean);
  return got.sort((a,b)=>b.points.length-a.points.length)[0]||{date,points:[]}}
async function chartLoad(){ // called after every flow.json load
  const live=D.timeseries;const gj=u=>fetch(u+"?ts="+Date.now(),{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null);
  const idx=await gj("data/timeseries/index.json")||await gj(RAW_TS+"index.json");
  CH.dates=(idx&&idx.dates)||[];if(live&&!CH.dates.includes(live.date))CH.dates.push(live.date);CH.dates.sort();
  if(!CH.date||CH.date===(live&&live.date)){CH.date=live?live.date:CH.dates[CH.dates.length-1];CH.series=live||(CH.date?await getSession(CH.date):null)}
  drawChart()}
async function goDate(step){const i=CH.dates.indexOf(CH.date)+step;if(i<0||i>=CH.dates.length)return;CH.date=CH.dates[i];CH.win=null;
  CH.series=(D.timeseries&&D.timeseries.date===CH.date)?D.timeseries:await getSession(CH.date);drawChart()}
function focusTicker(t){CH.focus=t;drawChart();document.querySelector("#flowChartCard").scrollIntoView({behavior:"smooth",block:"nearest"})}
function defWin(B){return[B.open,Math.max(B.last+5*60e3,Math.min(B.close,B.open+60*60e3))]}
function getWin(){return CH.win||defWin(CH.bounds)}
function controls(per){
  const tks=WATCH.filter(t=>per[t]);const latest=tks.map(t=>[t,per[t][per[t].length-1].net]).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  if(!CH.userSel||!CH.sel)CH.sel=new Set(latest.slice(0,5).map(x=>x[0]));
  let h="";
  if(CH.focus)h=`<button class="fc-back" id="fcBack">← Back to ${CH.view==="lines"?"lines":"heatmap"}</button><span class="fc-focus">${CH.focus} only${pos(CH.focus)}${er(CH.focus)}</span>`;
  else if(CH.view==="lines")h=`<button class="fchip ${CH.userSel?"":"on"}" data-t="TOP">Top 5 movers</button><button class="fchip" data-t="ALL">All</button>`+
     tks.map(t=>`<button class="fchip ${CH.sel.has(t)?"on":""}" data-t="${t}" title="Click to toggle · double-click to focus"><i style="background:${colorOf(t)}"></i>${t}</button>`).join("");
  else h=`<span class="fc-hint">Rows sorted by today's net (most bullish on top) · each cell = net premium that came in during that interval · click a row for its line chart</span>`;
  $("#fcChips").innerHTML=h+`<select id="fcFocus" title="Focus one ticker"><option value="">Focus ticker…</option>${tks.map(t=>`<option ${CH.focus===t?"selected":""}>${t}</option>`).join("")}</select>`;
  $("#fcChips").querySelectorAll(".fchip").forEach(b=>{b.onclick=()=>{const t=b.dataset.t;
      if(t==="TOP"){CH.userSel=false;CH.sel=null}else if(t==="ALL"){CH.userSel=true;CH.sel=new Set(tks)}
      else{CH.userSel=true;CH.sel.has(t)?CH.sel.delete(t):CH.sel.add(t);if(!CH.sel.size)CH.sel.add(t)}drawChart()};
    if(!["TOP","ALL"].includes(b.dataset.t))b.ondblclick=()=>focusTicker(b.dataset.t)});
  const fb=$("#fcBack");if(fb)fb.onclick=()=>{CH.focus=null;drawChart()};
  $("#fcFocus").onchange=e=>{CH.focus=e.target.value||null;drawChart()};
  $("#fcDate").textContent=CH.date?new Date(CH.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}):"–";
  $("#fcPrev").disabled=CH.dates.indexOf(CH.date)<=0;$("#fcNext").disabled=CH.dates.indexOf(CH.date)>=CH.dates.length-1;
  document.querySelectorAll("#fcMode button").forEach(b=>b.classList.toggle("on",b.dataset.v===CH.view));
  document.querySelectorAll("#fcScale button").forEach(b=>b.classList.toggle("on",b.dataset.v===CH.scale));
  $("#fcScale").style.display=(CH.view==="heat"&&!CH.focus)?"":"none";
  $("#fcNorm").checked=CH.norm;$("#fcNormWrap").style.display=(CH.view==="lines"&&!CH.focus)?"":"none";
}
function show(which){$("#fcHeat").style.display=which==="heat"?"":"none";$("#fcCanvasWrap").style.display=which==="chart"?"":"none"}
function drawChart(){
  const s=CH.series,msg=$("#fcMsg");
  if(!s||!s.points.length){msg.textContent="Collecting today's data: the first in-session snapshot hasn't been recorded yet.";msg.style.display="";show("none");$("#fcChips").innerHTML="";return}
  const per=perTicker(s),B=bounds(s);CH.bounds=B;CH.per=per;controls(per);
  if(s.points.length<2){msg.textContent=`Collecting today's data since ${etHM(B.first)} ET; the view appears after the next snapshot.`;msg.style.display="";show("none");return}
  msg.style.display="none";
  if(CH.chart){CH.chart.destroy();CH.chart=null}
  if(CH.focus&&per[CH.focus]){show("chart");drawFocus(per,B)}else if(CH.view==="lines"){show("chart");drawLines(per,B)}else{show("heat");drawHeat()}
  drawBrush();
  const tks=CH.focus?[CH.focus]:Object.keys(per);
  const flips=tks.flatMap(t=>per[t].filter((q,i,a)=>i&&Math.sign(q.net)!==Math.sign(a[i-1].net)&&q.net!==0).map(q=>({t,q})));
  flips.sort((a,b)=>a.q.x-b.q.x);
  $("#fcInfo").textContent=`${s.points.length} snapshots ${etHM(B.first)}–${etHM(B.last)} ET`+(flips.length?` · recent flips: ${flips.slice(-4).map(f=>`${f.t} → ${f.q.net>0?"bullish":"bearish"} ${etHM(f.q.x)}`).join(", ")}`:"");
}
// ---------- heatmap ----------
function heatColor(v,mx){if(v==null)return null;const f=mx?Math.abs(v)/mx:0;if(f<.04||Math.abs(v)<5e3)return"#2a3142";
  const a=(.18+.8*Math.sqrt(Math.min(1,f))).toFixed(2);return v>0?`rgba(34,197,94,${a})`:`rgba(239,68,68,${a})`}
function drawHeat(){
  const per=CH.per,[lo,hi]=getWin();const cols=CH.series.points.map(p=>Date.parse(p.ts)).filter(x=>x>=lo-1&&x<=hi+1);
  const el=$("#fcHeat");if(!cols.length){el.innerHTML='<div class="fc-msg">No snapshots in this time window.</div>';return}
  const rows=Object.keys(per).map(t=>{const m=new Map(per[t].map(q=>[q.x,q]));const cells=cols.map(x=>m.get(x)||null);
    const lastQ=[...cells].reverse().find(Boolean)||null;return{t,cells,cum:lastQ?lastQ.net:null,lastQ}}).sort((a,b)=>(b.cum??-1e18)-(a.cum??-1e18));
  const shared=Math.max(1,...rows.flatMap(r=>r.cells.map(q=>q&&!q.cu?Math.abs(q.d):0)));
  const cmax=Math.max(1,...rows.map(r=>Math.abs(r.cum||0)));const N=cols.length,showSign=N<=48,showVal=N<=10;
  let lastHalf=null;const labs=cols.map((x,i)=>{const hh=Math.floor((x-CH.bounds.open)/(30*60e3));const l=(N<=12||hh!==lastHalf)?etHM(x).replace(" AM","").replace(" PM",""):"";lastHalf=hh;return l});
  let h=`<div class="hm" style="grid-template-columns:76px repeat(${N},minmax(5px,1fr)) 150px">`;
  h+=`<div class="hm-h"></div>`+labs.map(l=>`<div class="hm-h hm-t">${l}</div>`).join("")+`<div class="hm-h hm-c">Day cumulative</div>`;
  rows.forEach(r=>{const mx=CH.scale==="row"?Math.max(1,...r.cells.map(q=>q&&!q.cu?Math.abs(q.d):0)):shared;
    h+=`<div class="hm-row" data-t="${r.t}"><div class="hm-tk">${r.t}${pos(r.t)}${typeof er==="function"?er(r.t).replace(/>📅 [^<]*</,">📅<"):""}</div>`;
    r.cells.forEach((q,i)=>{if(q&&q.cu){h+=`<div class="hm-cell cu" data-i="${i}"></div>`;return}const c=heatColor(q?q.d:null,mx),f=q?Math.abs(q.d)/mx:0;
      h+=`<div class="hm-cell ${q?"":"nd"}" data-i="${i}" style="${c?`background:${c}`:""}">${q&&showVal&&f>=.04?`<span>${sgn(q.d)}</span>`:q&&showSign&&f>=.35&&Math.abs(q.d)>=5e3?`<span>${q.d>0?"+":"−"}</span>`:""}</div>`});
    const w=r.cum==null?0:Math.abs(r.cum)/cmax*50;
    h+=`<div class="hm-cum"><span class="hm-bar"><i class="${(r.cum||0)>=0?"up":"dn"}" style="${(r.cum||0)>=0?"left:50%":"right:50%"};width:${w}%"></i></span><b class="${(r.cum||0)>=0?"C":"P"}">${r.cum==null?"–":sgn(r.cum)}</b></div></div>`});
  h+=`</div><div class="hm-leg"><span><i style="background:rgba(239,68,68,.95)"></i>bearish inflow</span><span><i style="background:#2a3142"></i>≈ 0</span><span><i style="background:rgba(34,197,94,.95)"></i>bullish inflow</span><span><i class="nd"></i>no data yet</span>${CH.series.points.some(p=>p.catchup)?`<span><i class="cu"></i>one-time catch-up (method switch, not new flow)</span>`:""}<span>Intensity ${CH.scale==="row"?"scaled to each ticker's own biggest interval (compare timing within a row)":"on one shared scale (compare size across rows)"} · “+/−” marks strong cells · first column = flow from 9:30 to that snapshot</span></div>`;
  el.innerHTML=h;
  const tip=$("#fcTip");
  el.querySelectorAll(".hm-row").forEach(row=>{const r=rows.find(x=>x.t===row.dataset.t);row.onclick=()=>focusTicker(r.t);
    row.onmousemove=e=>{const c=e.target.closest(".hm-cell");if(!c){tip.style.display="none";return}const i=+c.dataset.i,q=r.cells[i],x=cols[i];
      tip.innerHTML=`<b>${r.t}</b> · ${q&&q.prev?`${etHM(q.prev)}–`:"9:30–"}${etHM(x)} ET<br>`+(q?`Interval net <b class="${q.d>=0?"C":"P"}">${sgn(q.d)}</b>${q.first?" (since open, first snapshot)":""}${q.cu?"<br><i>One-time catch-up when incremental classification switched on: earlier volume of contracts not in the rebuilt history, classified at this snapshot. Not new flow.</i>":""}<br>Cumulative ${sgn(q.net)}<br>Bull $${money(q.b)} · Bear $${money(q.r)}`:"No data in this snapshot");
      tip.style.display="block";const W=window.innerWidth;tip.style.left=Math.min(W-230,e.clientX+12)+"px";tip.style.top=(e.clientY+14)+"px"};
    row.onmouseleave=()=>tip.style.display="none"});
}
// ---------- single-ticker focus: line (green/red fill) + interval bars underneath ----------
function drawFocus(per,B){const t=CH.focus,a=per[t],[lo,hi]=getWin();
  const line=a.map(q=>({x:q.x,y:q.net,q})),flip=a.map((q,i)=>i&&Math.sign(q.net)!==Math.sign(a[i-1].net)&&q.net!==0);
  const ds=[{type:"line",label:`${t} cumulative net`,data:line,yAxisID:"y",borderColor:"#e6e9f0",borderWidth:2,tension:0,
      pointRadius:a.map((q,i)=>flip[i]?6:2.5),pointBackgroundColor:a.map((q,i)=>flip[i]?(q.net>0?"#22c55e":"#ef4444"):"#e6e9f0"),pointBorderColor:a.map((q,i)=>flip[i]?"#fff":"transparent"),
      fill:{target:{value:0},above:"rgba(34,197,94,.28)",below:"rgba(239,68,68,.28)"}},
    {type:"bar",label:"Interval net",data:a.map(q=>({x:q.x,y:q.d,q})),yAxisID:"y2",backgroundColor:a.map(q=>q.cu?"rgba(148,163,184,.45)":q.d>=0?"rgba(34,197,94,.85)":"rgba(239,68,68,.85)"),barThickness:"flex",maxBarThickness:22}];
  const grid=c=>c.tick.value===0?"#9aa3b5":"#1f2635";const nets=a.map(q=>q.net),pad=(Math.max(0,...nets)-Math.min(0,...nets))*.08||1;
  const ed=typeof erDate==="function"?erDate(t).find(z=>z.date===CH.series.date):null;
  const erX=ed?(ed.e.timing==="BMO"?B.open:ed.e.timing==="AMC"?B.close:null):null;
  const erPlug={id:"erLine",afterDatasetsDraw(c){if(erX==null)return;const x=c.scales.x.getPixelForValue(erX),A=c.chartArea;if(x<A.left-1||x>A.right+1)return;const g=c.ctx;g.save();
    g.strokeStyle="rgba(167,139,250,.8)";g.setLineDash([4,3]);g.beginPath();g.moveTo(x,A.top);g.lineTo(x,A.bottom);g.stroke();g.setLineDash([]);g.fillStyle="#c4b5fd";g.font="bold 10px sans-serif";
    g.textAlign=x>A.right-40?"right":"left";g.fillText(`📅 ER ${ed.e.timing}`,x+(x>A.right-40?-4:4),A.top+10);g.restore()}};
  CH.chart=new Chart($("#fcCanvas"),{plugins:[erPlug],data:{datasets:ds},options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
    interaction:{mode:"nearest",axis:"x",intersect:false},
    scales:{x:{type:"linear",min:lo,max:hi,ticks:{color:"#8a93a6",maxRotation:0,callback:v=>etHM(v)},grid:{color:"#1f2635"}},
      y2:{stack:"f",stackWeight:1.3,offset:true,beginAtZero:true,ticks:{color:"#8a93a6",callback:sgn,maxTicksLimit:4},grid:{color:grid},title:{display:true,color:"#7c879c",text:"Per interval"}},
      y:{stack:"f",stackWeight:3,min:Math.min(0,...nets)-(Math.min(...nets)<0?pad:0),max:Math.max(0,...nets)+(Math.max(...nets)>0?pad:0),ticks:{color:"#8a93a6",callback:sgn},grid:{color:grid},title:{display:true,color:"#7c879c",text:"Cumulative net"}}},
    plugins:{legend:{labels:{color:"#c9d3ea",boxWidth:10}},
      tooltip:{callbacks:{title:it=>it.length?etHM(it[0].raw.x)+" ET":"",label:c=>{const q=c.raw.q;return c.datasetIndex?`Interval ${sgn(q.d)}${q.first?" (since open)":""}${q.cu?" (one-time catch-up, not new flow)":""}`:`Cumulative ${sgn(q.net)} · bull $${money(q.b)} · bear $${money(q.r)}`}}},
      zoom:zoomCfg(B)}}})}
// ---------- optional multi-line view ----------
function drawLines(per,B){const[lo,hi]=getWin();const tks=[...CH.sel].filter(t=>per[t]);
  const ds=tks.map(t=>{const a=per[t],tot=q=>(q.b+q.r)||1,c=colorOf(t);const flip=a.map((q,i)=>i&&Math.sign(q.net)!==Math.sign(a[i-1].net)&&q.net!==0);
    return{type:"line",label:t,data:a.map(q=>({x:q.x,y:CH.norm?q.net/tot(q)*100:q.net,q,t})),borderColor:c,backgroundColor:c,borderWidth:2.2,tension:0,
      pointRadius:flip.map(f=>f?5:0),pointBackgroundColor:a.map(q=>q.net>0?"#22c55e":"#ef4444"),pointBorderColor:"#fff"}});
  CH.chart=new Chart($("#fcCanvas"),{data:{datasets:ds},options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
    interaction:{mode:"nearest",axis:"x",intersect:false},
    scales:{x:{type:"linear",min:lo,max:hi,ticks:{color:"#8a93a6",maxRotation:0,callback:v=>etHM(v)},grid:{color:"#1f2635"}},
      y:{ticks:{color:"#8a93a6",callback:v=>CH.norm?v.toFixed(0)+"%":sgn(v)},grid:{color:c=>c.tick.value===0?"#9aa3b5":"#1f2635"},title:{display:true,color:"#7c879c",text:CH.norm?"Net as % of directional premium":"Cumulative net premium"}}},
    plugins:{legend:{labels:{color:"#e6e9f0",boxWidth:12},onClick:(e,item)=>focusTicker(item.text)},
      tooltip:{callbacks:{title:it=>it.length?etHM(it[0].raw.x)+" ET":"",label:c=>{const q=c.raw.q;return `${c.raw.t}: net ${sgn(q.net)} · Δ ${sgn(q.d)} · bull $${money(q.b)} · bear $${money(q.r)}`}}},
      zoom:zoomCfg(B)},
    onClick:(e,els,chart)=>{const h=chart.getElementsAtEventForMode(e,"nearest",{intersect:true},false);if(h.length)focusTicker(chart.data.datasets[h[0].datasetIndex].label)}}})}
function zoomCfg(B){return{pan:{enabled:true,mode:"x",onPanComplete:({chart})=>syncWin(chart)},zoom:{wheel:{enabled:true},pinch:{enabled:true},mode:"x",onZoomComplete:({chart})=>syncWin(chart)},
  limits:{x:{min:B.open-5*60e3,max:B.close+5*60e3}}}}
// ---------- time window (applies to heatmap and charts) ----------
function syncWin(chart){CH.win=[chart.scales.x.min,chart.scales.x.max];drawBrush()}
function setWin(lo,hi){const B=CH.bounds;if(!B)return;lo=Math.max(B.open,lo);hi=Math.min(B.close,hi);if(hi-lo<5*60e3)return;CH.win=[lo,hi];
  if(CH.chart){const x=CH.chart.options.scales.x;x.min=lo;x.max=hi;CH.chart.update("none")}else drawHeat();drawBrush()}
function preset(m){const B=CH.bounds;if(!B)return;if(m==="full")return setWin(B.open,B.close);const hi=Math.min(B.close,B.last+4*60e3);setWin(hi-m*60e3,hi)}
function drawBrush(){const B=CH.bounds,br=$("#fcBrush");if(!B)return;const span=B.close-B.open,[lo,hi]=getWin();
  const l=(lo-B.open)/span*100,r=(hi-B.open)/span*100,d=(B.last-B.open)/span*100;
  br.querySelector(".data").style.width=Math.max(0,Math.min(100,d))+"%";
  const w=br.querySelector(".win");w.style.left=Math.max(0,l)+"%";w.style.width=Math.max(1,Math.min(100,r)-Math.max(0,l))+"%"}
(function brushInit(){const br=$("#fcBrush");let drag=null;
  const msAt=cx=>{const r=br.getBoundingClientRect(),B=CH.bounds;return B.open+(cx-r.left)/r.width*(B.close-B.open)};
  br.addEventListener("pointerdown",e=>{if(!CH.bounds)return;const[lo,hi]=getWin(),m=msAt(e.clientX),tgt=e.target.dataset.h;
    drag={mode:tgt||(m>lo&&m<hi?"pan":"new"),m0:m,lo,hi};br.setPointerCapture(e.pointerId);e.preventDefault()});
  br.addEventListener("pointermove",e=>{if(!drag)return;const m=msAt(e.clientX),dm=m-drag.m0;
    if(drag.mode==="l")setWin(Math.min(m,drag.hi-5*60e3),drag.hi);else if(drag.mode==="r")setWin(drag.lo,Math.max(m,drag.lo+5*60e3));
    else if(drag.mode==="pan"){const B=CH.bounds,wd=drag.hi-drag.lo;const lo=Math.max(B.open,Math.min(B.close-wd,drag.lo+dm));setWin(lo,lo+wd)}
    else setWin(Math.min(drag.m0,m),Math.max(drag.m0,m))});
  const end=()=>drag=null;br.addEventListener("pointerup",end);br.addEventListener("pointercancel",end)})();
$("#fcPrev").onclick=()=>goDate(-1);$("#fcNext").onclick=()=>goDate(1);
document.querySelectorAll("#fcMode button").forEach(b=>b.onclick=()=>{CH.view=b.dataset.v;CH.focus=null;drawChart()});
document.querySelectorAll("#fcScale button").forEach(b=>b.onclick=()=>{CH.scale=b.dataset.v;drawChart()});
$("#fcNorm").onchange=e=>{CH.norm=e.target.checked;drawChart()};
document.querySelectorAll("#fcPresets button").forEach(b=>b.onclick=()=>{if(b.dataset.v==="auto"){CH.win=null;drawChart()}else preset(b.dataset.v==="full"?"full":+b.dataset.v)});
