// Farrell Flow — "Last 5 days": 5 prior completed sessions + today (live) once in-session data exists.
const HS={mode:"cp",focus:null,charts:[]};
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
function hDraw(){HS.charts.forEach(c=>c.destroy());HS.charts=[];const P=D.daily,body=$("#hBody");
  if(!P||!P.dates.length){body.innerHTML='<div class="fc-msg">No daily history yet.</div>';$("#hChips").innerHTML="";return}
  document.querySelectorAll("#hMode button").forEach(b=>b.classList.toggle("on",b.dataset.v===HS.mode));
  const tks=WATCH.filter(t=>tick(t));
  $("#hChips").innerHTML=(HS.focus?`<button class="fc-back" id="hBack">← Back to all</button>`:`<button class="fchip on">Small multiples</button>`)+
    tks.map(t=>`<button class="fchip ${HS.focus===t?"on":""}" data-t="${t}">${t}</button>`).join("");
  $("#hChips").querySelectorAll(".fchip[data-t]").forEach(b=>b.onclick=()=>{HS.focus=b.dataset.t;hDraw()});
  const bk=$("#hBack");if(bk)bk.onclick=()=>{HS.focus=null;hDraw()};
  if(HS.focus){body.innerHTML=`<div class="h-big"><div class="h-title">${HS.focus}${pos(HS.focus)}</div><div class="h-cv"><canvas></canvas></div></div>`;hChart(body.querySelector("canvas"),HS.focus,true)}
  else{body.innerHTML=`<div class="h-grid">${tks.map(t=>`<div class="h-mini" data-t="${t}"><div class="h-title">${t}${pos(t)}<span class="h-v"></span></div><div class="h-cv"><canvas></canvas></div></div>`).join("")}</div>`;
    body.querySelectorAll(".h-mini").forEach(m=>{const S=hChart(m.querySelector("canvas"),m.dataset.t,false);const tot=S.reduce((a,s)=>a+(s.v||0),0),has=S.some(s=>s.v!=null);
      m.querySelector(".h-v").innerHTML=has?`<b class="${tot>=0?"C":"P"}">${HS.mode==="net"?sgn(tot):(tot>0?"+":"")+n(tot)}</b>`:"–";m.onclick=()=>{HS.focus=m.dataset.t;hDraw()}})}
  const inf=P.dates.filter(d=>P.inferred[d]),occ=P.dates.filter(d=>P.occ_cp[d]);
  $("#hNote").innerHTML=HS.mode==="net"?`<b>Inferred net premium</b> (bullish − bearish, side inferred from delayed snapshots) exists only from Oct 28 onward: ${inf.length} of ${P.dates.length} days have it; earlier days are blank, not estimated. Switch to “Call vs put volume” for the volume-based history.${P.today?" Hatched bar = today, live and updating.":""} Yellow line = cumulative across the bars shown.`
    :`<b>Volume-based (no side)</b>: calls − puts in contracts. Completed days are OCC cleared volume (${occ.length} days); ${P.today?"today's hatched bar is Yahoo's session volume so far (live, partial, ~15 min delayed). ":""}Shows call/put skew, not whether trades were bought or sold. Yellow line = cumulative across the bars shown.`}
document.querySelectorAll("#hMode button").forEach(b=>b.onclick=()=>{HS.mode=b.dataset.v;hDraw()});
