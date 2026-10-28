// Farrell Flow — intraday net-flow chart built from pipeline snapshots (each point = one delayed snapshot; side inferred).
const RAW_TS="https://raw.githubusercontent.com/bobbyfarrell20/options-flow-dashboard/main/data/timeseries/";
const PAL=["#4cc9f0","#f72585","#ffd166","#06d6a0","#b388ff","#ff8c42","#90be6d","#e76f51","#00b4d8","#f4a261","#c77dff","#80ed99","#ef476f","#8ecae6","#ffb4a2","#a3b18a"];
const CH={sel:null,focus:null,mode:"cum",norm:false,date:null,series:null,dates:[],win:null,chart:null,userSel:false};
const etHM=ms=>new Date(ms).toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit"});
const sgn=v=>(v>0?"+":v<0?"-":"")+money(Math.abs(v));
const colorOf=t=>PAL[Math.max(0,WATCH.indexOf(t))%PAL.length];
function bounds(s){const p=s.points;if(!p.length)return null;const off=p[0].ts.slice(19)||"-04:00";
  return{open:Date.parse(s.date+"T09:30:00"+off),close:Date.parse(s.date+"T16:00:00"+off),first:Date.parse(p[0].ts),last:Date.parse(p[p.length-1].ts)}}
function perTicker(s){const out={};s.points.forEach(p=>{const x=Date.parse(p.ts);for(const[t,v]of Object.entries(p.t)){(out[t]=out[t]||[]).push({x,b:v[0],r:v[1],net:v[2],vol:v[3]})}});
  for(const a of Object.values(out))a.forEach((q,i)=>{q.d=i?q.net-a[i-1].net:null});return out}
async function getSession(date){const get=u=>fetch(u+"?ts="+Date.now(),{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null);
  const got=(await Promise.all([get("data/timeseries/"+date+".json"),get(RAW_TS+date+".json")])).filter(Boolean);
  return got.sort((a,b)=>b.points.length-a.points.length)[0]||{date,points:[]}}
async function chartLoad(){ // called after every flow.json load
  const live=D.timeseries;const idx=await fetch("data/timeseries/index.json?ts="+Date.now(),{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null)
    ||await fetch(RAW_TS+"index.json?ts="+Date.now(),{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null);
  CH.dates=(idx&&idx.dates)||[];if(live&&!CH.dates.includes(live.date))CH.dates.push(live.date);CH.dates.sort();
  if(!CH.date||CH.date===(live&&live.date)){CH.date=live?live.date:CH.dates[CH.dates.length-1];CH.series=live||(CH.date?await getSession(CH.date):null)}
  drawChart()}
async function goDate(step){const i=CH.dates.indexOf(CH.date)+step;if(i<0||i>=CH.dates.length)return;CH.date=CH.dates[i];CH.win=null;
  CH.series=(D.timeseries&&D.timeseries.date===CH.date)?D.timeseries:await getSession(CH.date);drawChart()}
function focusTicker(t){CH.focus=t;CH.win=CH.win;drawChart();document.querySelector("#flowChartCard").scrollIntoView({behavior:"smooth",block:"nearest"})}
function chartControls(per){
  const latest=Object.entries(per).map(([t,a])=>[t,a[a.length-1].net]).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  if(!CH.userSel||!CH.sel)CH.sel=new Set(latest.slice(0,5).map(x=>x[0]));
  const tks=WATCH.filter(t=>per[t]);
  $("#fcChips").innerHTML=(CH.focus?`<button class="fc-back" id="fcBack">← Back to all</button><span class="fc-focus"><i style="background:${colorOf(CH.focus)}"></i>${CH.focus} only${pos(CH.focus)}</span>`:
     `<button class="fchip ${CH.userSel?"":"on"}" data-t="TOP">Top 5 movers</button><button class="fchip" data-t="ALL">All</button>`+
     tks.map(t=>`<button class="fchip ${CH.sel.has(t)?"on":""}" data-t="${t}" title="Click to toggle · double-click to focus"><i style="background:${colorOf(t)}"></i>${t}</button>`).join(""))
    +`<select id="fcFocus" title="Focus one ticker (auto-scaled)"><option value="">Focus ticker…</option>${tks.map(t=>`<option ${CH.focus===t?"selected":""}>${t}</option>`).join("")}</select>`;
  $("#fcChips").querySelectorAll(".fchip").forEach(b=>{b.onclick=()=>{const t=b.dataset.t;
      if(t==="TOP"){CH.userSel=false;CH.sel=null}else if(t==="ALL"){CH.userSel=true;CH.sel=new Set(tks)}
      else{CH.userSel=true;CH.sel.has(t)?CH.sel.delete(t):CH.sel.add(t);if(!CH.sel.size)CH.sel.add(t)}drawChart()};
    if(b.dataset.t.length&&!["TOP","ALL"].includes(b.dataset.t))b.ondblclick=()=>focusTicker(b.dataset.t)});
  const fb=$("#fcBack");if(fb)fb.onclick=()=>{CH.focus=null;drawChart()};
  $("#fcFocus").onchange=e=>{CH.focus=e.target.value||null;drawChart()};
  $("#fcDate").textContent=CH.date?new Date(CH.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}):"–";
  $("#fcPrev").disabled=CH.dates.indexOf(CH.date)<=0;$("#fcNext").disabled=CH.dates.indexOf(CH.date)>=CH.dates.length-1;
  document.querySelectorAll("#fcMode button").forEach(b=>b.classList.toggle("on",b.dataset.v===CH.mode));
  $("#fcNorm").checked=CH.norm;$("#fcNormWrap").style.display=CH.focus?"none":"";
}
function drawChart(){
  const s=CH.series,msg=$("#fcMsg");
  if(!s||!s.points.length){msg.textContent="Collecting today's data: the first in-session snapshot hasn't been recorded yet.";msg.style.display="";$("#fcCanvasWrap").style.visibility="hidden";$("#fcChips").innerHTML="";return}
  const per=perTicker(s),B=bounds(s);chartControls(per);
  if(s.points.length<2){msg.textContent=`Collecting today's data since ${etHM(B.first)} ET; the chart appears after the next snapshot.`;msg.style.display="";$("#fcCanvasWrap").style.visibility="hidden";return}
  msg.style.display="none";$("#fcCanvasWrap").style.visibility="visible";
  const tks=CH.focus?[CH.focus]:[...CH.sel].filter(t=>per[t]);const cum=CH.mode==="cum",focus=!!CH.focus;
  const ds=tks.map(t=>{const a=per[t],tot=q=>(q.b+q.r)||1,mxd=Math.max(1,...a.map(q=>Math.abs(q.d||0)));
    const data=a.map((q,i)=>({x:q.x,y:cum?(CH.norm&&!focus?q.net/tot(q)*100:q.net):(i?(CH.norm&&!focus?q.d/mxd*100:q.d):null),q,t}));
    const flip=data.map((p,i)=>cum&&i&&Math.sign(a[i].net)!==Math.sign(a[i-1].net)&&a[i].net!==0);
    const c=colorOf(t);
    return cum?{type:"line",label:t,data,borderColor:focus?"#e6e9f0":c,borderWidth:focus?2:1.6,tension:0,
        pointRadius:data.map((p,i)=>flip[i]?5:(focus?2.5:0)),pointHoverRadius:5,
        pointBackgroundColor:data.map((p,i)=>flip[i]?(a[i].net>0?"#22c55e":"#ef4444"):(focus?"#e6e9f0":c)),pointBorderColor:data.map((p,i)=>flip[i]?"#fff":"transparent"),
        fill:focus?{target:{value:0},above:"rgba(34,197,94,.22)",below:"rgba(239,68,68,.22)"}:false}
      :{type:"bar",label:t,data,backgroundColor:focus?data.map(p=>(p.y||0)>=0?"rgba(34,197,94,.75)":"rgba(239,68,68,.75)"):c,barPercentage:.9,categoryPercentage:.9}});
  const lo=CH.win?CH.win[0]:B.open,hi=CH.win?CH.win[1]:Math.max(B.last+5*60e3,Math.min(B.close,B.open+60*60e3));
  const yFmt=v=>CH.norm&&!focus?v.toFixed(0)+"%":sgn(v);
  const cfg={data:{datasets:ds},options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,normalized:true,
    interaction:{mode:"nearest",axis:"x",intersect:false},
    scales:{x:{type:"linear",min:lo,max:hi,offset:!cum,ticks:{color:"#8a93a6",maxRotation:0,callback:v=>etHM(v)},grid:{color:"#1f2635"}},
      y:{ticks:{color:"#8a93a6",callback:yFmt},grid:{color:c=>c.tick.value===0?"#9aa3b5":"#1f2635",lineWidth:c=>c.tick.value===0?1.5:1},
        title:{display:true,color:"#7c879c",text:cum?(CH.norm&&!focus?"Net as % of directional premium":"Cumulative net premium"):(CH.norm&&!focus?"Interval net (% of own max)":"Net change since prior snapshot")}}},
    plugins:{legend:{display:!focus,labels:{color:"#c9d3ea",boxWidth:10,boxHeight:10},onClick:(e,item)=>focusTicker(item.text)},
      tooltip:{callbacks:{title:it=>it.length?etHM(it[0].raw.x)+" ET snapshot":"",
        label:c=>{const q=c.raw.q;return `${c.raw.t}: net ${sgn(q.net)} · bull $${money(q.b)} · bear $${money(q.r)} · Δ ${q.d==null?"–":sgn(q.d)}`}}},
      zoom:{pan:{enabled:true,mode:"x",onPanComplete:({chart})=>syncWin(chart)},zoom:{wheel:{enabled:true},pinch:{enabled:true},mode:"x",onZoomComplete:({chart})=>syncWin(chart)},
        limits:{x:{min:B.open-5*60e3,max:B.close+5*60e3}}}},
    onClick:(e,els,chart)=>{if(focus)return;const h=chart.getElementsAtEventForMode(e,"nearest",{intersect:true},false);if(h.length)focusTicker(chart.data.datasets[h[0].datasetIndex].label)}}};
  if(CH.chart)CH.chart.destroy();CH.chart=new Chart($("#fcCanvas"),cfg);
  CH.bounds=B;drawBrush();
  const flips=tks.flatMap(t=>per[t].filter((q,i,a)=>i&&Math.sign(q.net)!==Math.sign(a[i-1].net)&&q.net!==0).map(q=>`${t} ${q.net>0?"→ bullish":"→ bearish"} ${etHM(q.x)}`));
  $("#fcInfo").textContent=`${s.points.length} snapshots ${etHM(B.first)}–${etHM(B.last)} ET`+(flips.length?` · flips: ${flips.slice(-4).join(", ")}`:"");
}
function syncWin(chart){CH.win=[chart.scales.x.min,chart.scales.x.max];drawBrush()}
function setWin(lo,hi){const B=CH.bounds;lo=Math.max(B.open,lo);hi=Math.min(B.close,hi);if(hi-lo<5*60e3)return;CH.win=[lo,hi];
  const x=CH.chart.options.scales.x;x.min=lo;x.max=hi;CH.chart.update("none");drawBrush()}
function preset(m){const B=CH.bounds;if(!B)return;if(m==="full"){CH.win=[B.open,B.close];return drawChart()}
  const hi=Math.min(B.close,B.last+2*60e3);setWin(hi-m*60e3,hi)}
function drawBrush(){const B=CH.bounds,br=$("#fcBrush");if(!B||!CH.chart)return;const span=B.close-B.open,x=CH.chart.scales.x;
  const l=(x.min-B.open)/span*100,r=(x.max-B.open)/span*100,d=(B.last-B.open)/span*100;
  br.querySelector(".data").style.width=Math.max(0,Math.min(100,d))+"%";
  const w=br.querySelector(".win");w.style.left=Math.max(0,l)+"%";w.style.width=Math.max(1,Math.min(100,r)-Math.max(0,l))+"%"}
(function brushInit(){const br=$("#fcBrush"),w=br.querySelector(".win");let drag=null;
  const msAt=cx=>{const r=br.getBoundingClientRect(),B=CH.bounds;return B.open+(cx-r.left)/r.width*(B.close-B.open)};
  br.addEventListener("pointerdown",e=>{if(!CH.chart)return;const x=CH.chart.scales.x,m=msAt(e.clientX),tgt=e.target.dataset.h;
    drag={mode:tgt||(m>x.min&&m<x.max?"pan":"new"),m0:m,lo:x.min,hi:x.max};if(drag.mode==="new"){drag.lo=drag.hi=m}
    br.setPointerCapture(e.pointerId);e.preventDefault()});
  br.addEventListener("pointermove",e=>{if(!drag)return;const m=msAt(e.clientX),dm=m-drag.m0;
    if(drag.mode==="l")setWin(Math.min(m,drag.hi-5*60e3),drag.hi);else if(drag.mode==="r")setWin(drag.lo,Math.max(m,drag.lo+5*60e3));
    else if(drag.mode==="pan"){const B=CH.bounds,wd=drag.hi-drag.lo;let lo=Math.max(B.open,Math.min(B.close-wd,drag.lo+dm));setWin(lo,lo+wd)}
    else setWin(Math.min(drag.m0,m),Math.max(drag.m0,m))});
  const end=()=>drag=null;br.addEventListener("pointerup",end);br.addEventListener("pointercancel",end)})();
$("#fcPrev").onclick=()=>goDate(-1);$("#fcNext").onclick=()=>goDate(1);
document.querySelectorAll("#fcMode button").forEach(b=>b.onclick=()=>{CH.mode=b.dataset.v;drawChart()});
$("#fcNorm").onchange=e=>{CH.norm=e.target.checked;drawChart()};
document.querySelectorAll("#fcPresets button").forEach(b=>b.onclick=()=>b.dataset.v==="auto"?(CH.win=null,drawChart()):preset(b.dataset.v==="full"?"full":+b.dataset.v));
