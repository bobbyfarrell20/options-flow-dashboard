const RAW_URL="https://raw.githubusercontent.com/bobbyfarrell20/options-flow-dashboard/main/data/flow.json";
const WATCH=["TSLA","NVDA","PLTR","MU","SKM","TSM","INTC","MRVL","BE","MSTR","ASST","SPCX","ECHO","TE","VST","LYFT"];
const st={tk:new Set(),cp:"all",sent:"all",minPrem:100000,dte:"9999",unusual:false,otm:false,q:"",sort:"premium",dir:-1};
let D=null;const $=s=>document.querySelector(s);
const money=v=>v==null?"–":(Math.abs(v)>=1e9?(v/1e9).toFixed(2)+"B":Math.abs(v)>=1e6?(v/1e6).toFixed(2)+"M":Math.abs(v)>=1e3?(v/1e3).toFixed(0)+"K":Math.round(v)+"");
const n=v=>v==null?"–":Number(v).toLocaleString();
const tfmt=s=>{if(!s)return"–";const d=new Date(s);return d.toLocaleString("en-US",{timeZone:"America/New_York",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit"})};
async function load(){
  // Fetch both the Pages copy and the raw GitHub copy (updates right after a workflow commit) and keep the newest snapshot.
  const ts=Date.now(),get=u=>fetch(u+"?ts="+ts,{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null);
  const got=(await Promise.all([get("data/flow.json"),get(RAW_URL)])).filter(Boolean);
  if(!got.length){$("#stamp").textContent="Could not load data";return false}
  D=got.sort((a,b)=>new Date(b.generated_at)-new Date(a.generated_at))[0];
  const g=new Date(D.generated_at);
  $("#stamp").textContent=`Snapshot ${g.toLocaleString("en-US",{timeZone:"America/New_York",weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} ET · ${D.market_open_at_snapshot?"market open (delayed)":"market closed — latest session"}`;
  $("#dot").className="dot "+(D.market_open_at_snapshot?"live":"closed");
  const ok=D.tickers.filter(t=>t.status==="ok");
  const cp=ok.reduce((a,t)=>a+t.call_premium,0),pp=ok.reduce((a,t)=>a+t.put_premium,0);
  $("#hdrStats").innerHTML=`<div>Call prem <b class="C">$${money(cp)}</b></div><div>Put prem <b class="P">$${money(pp)}</b></div><div>P/C prem <b>${(pp/cp).toFixed(2)}</b></div><div>Tape rows <b>${D.flow.length}</b></div>`;
  chips();board();leaders();overview();render();radar();if(st.tk.size===1)detail([...st.tk][0]);
  try{if(typeof chartLoad==="function")await chartLoad();if(typeof hDraw==="function")hDraw()}catch(e){console.error(e)}
  return true;
}
function erNote(){const l=WATCH.map(t=>[t,erInfo(t)]).filter(x=>x[1]);return ` 📅 = earnings within 7 days or reported in the last day (bright = within 2 days; dashed = date estimated/unconfirmed; hover for source). ${l.length?"Now: "+l.map(([t,x])=>t+" "+x.label).join(", ")+".":"None in the next 7 days."}`}
function volNote(){const m=D.volume_meta;if(!m)return"";const ok=D.tickers.filter(t=>t.vol_vs_avg&&t.vol_vs_avg.baseline_days>=m.min_days).length;
  const fl=D.tickers.filter(t=>t.vol_vs_avg&&t.vol_vs_avg.flag).map(t=>t.ticker);
  return ok?` 🔥 = options volume ≥1.5x (strong ≥3x) its ${m.lookback}-session average daily options volume from OCC (pace-adjusted intraday; hover a badge for details). Flagged: ${fl.join(", ")||"none"}.${erNote()}${sqNote()}`:" 🔥 Unusual-volume badges: baseline building (need "+m.min_days+" sessions of OCC history).";}
function board(){
  const b=D.sentiment_board;if(!b){$("#sentboard").style.display="none";return}
  const tot=b.bull_total+b.bear_total,bp=tot?b.bull_total/tot*100:50;
  if(!tot){$("#sbStrip").innerHTML=`<div class="sb-pct">No inferred bullish/bearish flow yet: the latest quotes are outside the trading session, so trade side can't be inferred. Updates after the next market-hours refresh.</div>`}else
  {$("#sbStrip").innerHTML=`<div><div class="lbl">Bullish premium</div><div class="val g">$${money(b.bull_total)}</div><div class="sb-pct">${n(b.bull_orders)} orders</div></div>
   <div class="sb-ratio" title="Bullish share of inferred directional premium"><i style="width:${bp.toFixed(1)}%"></i></div>
   <div style="text-align:right"><div class="lbl">Bearish premium</div><div class="val r">$${money(b.bear_total)}</div><div class="sb-pct">${n(b.bear_orders)} orders</div></div>
   <div class="sb-pct"><b class="C">${bp.toFixed(0)}%</b> bull / <b class="P">${(100-bp).toFixed(0)}%</b> bear<br><span class="muted">Bull:Bear ${b.bear_total?(b.bull_total/b.bear_total).toFixed(2):"–"}</span></div>`;}
  const fill=(id,rows)=>{const top=rows.length?rows[0].premium:1;
    $(id).innerHTML=rows.length?rows.map(r=>`<tr data-t="${r.ticker}" class="${st.tk.size===1&&st.tk.has(r.ticker)?"sel":""}" style="background-size:${Math.max(2,r.premium/top*100).toFixed(1)}% 100%"><td>${r.ticker}${vb(r.ticker)}</td><td>${n(r.orders)}</td><td>${money(r.premium)}</td></tr>`).join(""):`<tr class="empty"><td colspan="3">No inferred flow available</td></tr>`;
    $(id).querySelectorAll("tr[data-t]").forEach(e=>e.onclick=()=>{pick(e.dataset.t);document.querySelector(".tablewrap").scrollIntoView({behavior:"smooth"})});};
  const nets=D.tickers.filter(t=>t.status==="ok").map(t=>{const f=t.flow_sentiment||{},has=t.side_source!=="unavailable"&&((f.bull_premium||0)+(f.bear_premium||0))>0;
    return {ticker:t.ticker,has,net:(f.bull_premium||0)-(f.bear_premium||0),no:(f.bull_orders||0)-(f.bear_orders||0)}});
  D.tickers.filter(t=>t.status!=="ok").forEach(t=>nets.push({ticker:t.ticker,has:false,net:0,no:0}));
  const withD=nets.filter(x=>x.has).sort((a,b)=>b.net-a.net),noD=nets.filter(x=>!x.has);
  const mx=Math.max(1,...withD.map(x=>Math.abs(x.net))),sg=v=>(v>0?"+":v<0?"-":"")+money(Math.abs(v));
  const tn=b.bull_total-b.bear_total;
  $("#netTotal").innerHTML=`Watchlist <b class="${tn>=0?"C":"P"}">${sg(tn)}</b>`;
  $("#sbNet").innerHTML=withD.map(x=>{const w=(Math.abs(x.net)/mx*50).toFixed(1);
    return `<tr data-t="${x.ticker}" class="${st.tk.size===1&&st.tk.has(x.ticker)?"sel":""}"><td>${x.ticker}${vb(x.ticker)}</td><td class="c"><div class="dv"><i class="${x.net>=0?"pos":"neg"}" style="width:${w}%"></i><span class="${x.net>=0?"C":"P"}">${sg(x.net)}</span></div></td><td class="r">${x.no>0?"+":""}${n(x.no)}</td></tr>`}).join("")
   +noD.map(x=>`<tr data-t="${x.ticker}" class="nodata"><td>${x.ticker}</td><td class="c">—</td><td class="r">—</td></tr>`).join("");
  $("#sbNet").querySelectorAll("tr[data-t]").forEach(e=>e.onclick=()=>{pick(e.dataset.t);if(typeof focusTicker==="function")focusTicker(e.dataset.t)});
  const src=b.side_sources||{},cached=Object.keys(src).filter(k=>src[k]==="cached"),na=Object.keys(src).filter(k=>src[k]==="unavailable");
  let extra="";if(cached.length)extra+=` Sides for ${cached.join(", ")} carried from the last in-session snapshot (current quotes are pre-market/after-hours).`;
  if(na.length)extra+=` No side data for ${na.join(", ")} (no trades yet in the current session, or quotes outside session hours).`;
  $("#sbNote").dataset.base=$("#sbNote").dataset.base||$("#sbNote").textContent;$("#sbNote").textContent=$("#sbNote").dataset.base+extra+volNote();
}
function tick(t){return D.tickers.find(x=>x.ticker===t)}
const POSITIONS=new Set(["LYFT"]); // tickers Bobby holds a position in (marker only, no details)
function pos(t){return POSITIONS.has(t)?'<span class="postag" title="You hold a position in this ticker">POS</span>':""}
function vb(t,full){return pos(t)+er(t,!full)+sq(t,!full)+vb0(t)}
const SQ_INFO="Squeeze meter = a risk gauge, not a confirmation. It cannot confirm a squeeze in real time: short interest is reported twice a month (FINRA settlement dates, published ~1-2 weeks later) and Yahoo's short % of float lags the same way. Score 0-100 = geometric mean of SETUP (short % of float, days to cover, short-interest change) and TRIGGER (price momentum, stock & options volume, inferred flow, short-dated OTM calls, GEX sign), capped below 40 unless setup ≥40 and trigger ≥25, and below 60 unless setup ≥60 and trigger ≥40. Shown only at 40+: 40-59 Squeeze watch, 60+ Squeeze conditions. No borrow-fee data (no free source).";
function sqNote(){const T=D&&D.squeeze&&D.squeeze.tickers;if(!T)return"";const l=Object.entries(T).filter(([k,v])=>v.score>=40).sort((a,b)=>b[1].score-a[1].score).map(([k,v])=>`${k} ${v.score}`);
  return ` Squeeze meter badge (gauge, 40+ only; risk gauge, not confirmation; short data biweekly/lagged; click for factors): ${l.join(", ")||"none at 40+"}.`}
function sqInfo(t){const S=D&&D.squeeze&&D.squeeze.tickers&&D.squeeze.tickers[t];return S||null}
function gauge(v){const a=Math.PI*(1-Math.max(0,Math.min(100,v))/100),x=(8+6*Math.cos(a)).toFixed(1),y=(8-6*Math.sin(a)).toFixed(1);
  return `<svg class="sqg" viewBox="0 0 16 9" width="14" height="8"><path d="M2 8A6 6 0 0 1 14 8" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/><path d="M2 8A6 6 0 0 ${v>50?1:0} 1 ${x} ${y}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`}
function sq(t,compact){const S=sqInfo(t);if(!S||S.score==null||S.score<40)return"";const lv=S.score>=60?"cond":"watch";
  const tip=`${S.score>=60?"Squeeze conditions":"Squeeze watch"} ${S.score}/100 (setup ${S.setup}, trigger ${S.trigger}). Short interest as of ${S.si_date||"n/a"}. Risk gauge only, not a confirmed squeeze; short data is biweekly and lagged. Click for factors.`;
  return ` <span class="sqtag ${lv}" data-sq="${t}" title="${tip}">${gauge(S.score)}${compact?"":(S.score>=60?" Squeeze ":" Sq watch ")}${S.score}</span>`}
const SQ_LAB={si_float:["Short % of float","%"],dtc:["Days to cover",""],si_change:["Short interest change","%"],day:["Price today","%"],d5:["5-day change","%"],vs_high:["vs prior 20-session high","%"],rel_vol:["Stock volume vs 20d avg","x"],opt_pace:["Options volume vs 20d avg","x"],net_prem:["Net inferred premium (bull−bear)/total",""],cs_skew:["Call share vs 20d avg","pp"],otm_short:["Short-dated OTM call share","%"],gex:["Est. net GEX sign",""]};
const sqZone=v=>v==null?"na":v>=60?"cond":v>=40?"watch":"low";
function bigGauge(v){const R=80,cx=100,cy=92,pt=a=>[cx+R*Math.cos(Math.PI*(1-a/100)),cy-R*Math.sin(Math.PI*(1-a/100))];
  const arc=(a,b,c)=>{const [x1,y1]=pt(a),[x2,y2]=pt(b);return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${c}" stroke-width="14" fill="none"/>`};
  const tick=a=>{const [x1,y1]=[cx+(R-11)*Math.cos(Math.PI*(1-a/100)),cy-(R-11)*Math.sin(Math.PI*(1-a/100))],[x2,y2]=[cx+(R+11)*Math.cos(Math.PI*(1-a/100)),cy-(R+11)*Math.sin(Math.PI*(1-a/100))];return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#0b0f17" stroke-width="2"/>`};
  const lab=a=>{const [x,y]=[cx+(R+18)*Math.cos(Math.PI*(1-a/100)),cy-(R+18)*Math.sin(Math.PI*(1-a/100))];return `<text x="${x.toFixed(1)}" y="${(y+3).toFixed(1)}" class="gl">${a}</text>`};
  let nd="";if(v!=null){const a=Math.PI*(1-Math.max(0,Math.min(100,v))/100),x=cx+(R-4)*Math.cos(a),y=cy-(R-4)*Math.sin(a);
    nd=`<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#f8fafc" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="#f8fafc"/>`}
  return `<svg class="biggauge" viewBox="-14 -14 228 114">${arc(0,40,"#3f4655")}${arc(40,60,"#f59e0b")}${arc(60,100,"#ea4c1b")}${tick(40)}${tick(60)}${lab(0)}${lab(40)}${lab(60)}${lab(100)}${nd}</svg>`}
function hbar(lbl,v,tip){return `<div class="sqbar" title="${tip}"><span>${lbl}</span><div class="trk"><i class="${sqZone(v)}" style="width:${v??0}%"></i><b style="left:40%"></b><b style="left:60%"></b></div><em>${v??"–"}</em></div>`}
function sqChips(S){const W=D.squeeze.weights||{},F=S.factors,out=[];
  const fmt={si_float:v=>`Short ${Math.round(v)}% float`,dtc:v=>`${(+v).toFixed(1)} days to cover`,si_change:v=>`SI ${v>0?"+":""}${(+v).toFixed(1)}%`,day:v=>`Price ${v>0?"+":""}${(+v).toFixed(1)}%`,d5:v=>`5d ${v>0?"+":""}${(+v).toFixed(1)}%`,
    vs_high:v=>v>=0?"At 20d high":`${(+v).toFixed(0)}% vs 20d high`,rel_vol:v=>`Stock vol ${(+v).toFixed(1)}x`,opt_pace:v=>`Opt vol ${(+v).toFixed(1)}x`,net_prem:v=>`Net prem ${v>0?"+":""}${Math.round(v*100)}%`,cs_skew:v=>`Calls ${v>0?"+":""}${(+v).toFixed(0)}pp`,otm_short:v=>`ST OTM calls ${Math.round(v)}%`,gex:v=>v<0?"GEX negative":"GEX positive"};
  for(const [grp,ks] of [["setup",["si_float","dtc","si_change"]],["trigger",["day","d5","vs_high","rel_vol","opt_pace","net_prem","cs_skew","otm_short","gex"]]])for(const k of ks){const f=F[k];if(!f||f.value==null||f.sub==null)continue;
    out.push({k,grp,sub:f.sub,w:(W[grp]||{})[k]||0,txt:fmt[k](f.value)})}
  const key=new Set(["si_float","dtc","day"]);
  return out.filter(o=>key.has(o.k)||o.sub>=30).sort((a,b)=>b.sub*b.w-a.sub*a.w).slice(0,8)
    .map(o=>`<span class="sqchip ${o.sub>=60?"hi":o.sub>=30?"mid":"lo"} ${o.grp}" title="${SQ_LAB[o.k][0]} · ${o.sub}/100 pts × ${Math.round(o.w*100)}% weight (${o.grp})">${o.grp==="setup"?"◆":"▲"} ${o.txt}</span>`).join("")}
function sqPanel(t){const S=sqInfo(t);if(!S)return"";const W=(D.squeeze.weights||{});
  const row=(k,grp)=>{const f=S.factors[k];if(!f)return"";const [lab,u]=SQ_LAB[k];let v=f.value;
    if(v==null)v='<span class="muted">n/a</span>';else if(k==="gex")v=(v<0?"negative":"positive")+` ($${money(Math.abs(v))})`;else v=(typeof v==="number"&&v>0&&["si_change","day","d5","cs_skew","net_prem"].includes(k)?"+":"")+v+u;
    return `<tr><td>${lab}</td><td>${v}</td><td>${f.sub==null?"–":f.sub}</td><td>${Math.round((W[grp]||{})[k]*100)}%</td><td class="muted" title="${f.date||""} · ${f.source}">${f.date?(+f.date.slice(5,7))+"/"+(+f.date.slice(8)):"–"}</td></tr>`};
  const z=sqZone(S.score),lv=S.score==null?"Not scored":S.score>=60?"Squeeze conditions":S.score>=40?"Squeeze watch":"No squeeze setup";
  const weak=S.setup!=null&&S.trigger!=null?(S.setup<40&&S.trigger<25?"Both sides weak":S.setup<S.trigger?"Short-interest setup is the weak side":"Momentum/flow trigger is the weak side"):"";
  return `<div class="sqpanel"><div class="sqhead"><b>Squeeze meter</b> <span class="info" title="${SQ_INFO}">ⓘ</span><span class="muted">risk gauge · not a confirmation</span></div>
   <div class="sqviz"><div class="sqg-wrap">${bigGauge(S.score)}<div class="sqscore ${z}"><b>${S.score??"–"}</b><span>${lv}</span></div></div>
   <div class="sqside">${hbar("Setup",S.setup,"Short-interest side: short % of float, days to cover, SI change (as of "+(S.si_date||"n/a")+")")}${hbar("Trigger",S.trigger,"Momentum + flow side: price moves, stock/options volume, inferred premium, short-dated OTM calls, GEX sign (today)")}
   <div class="muted sqweak">${weak}</div></div></div>
   <div class="sqchips">${sqChips(S)}</div>
   <details class="sqdet"><summary>Show factor details</summary>
   <table class="sqt"><tr><th>Factor</th><th>Value</th><th>Pts</th><th>Wt</th><th>As of</th></tr>
   <tr class="grp"><td colspan="5">Setup (short interest)</td></tr>${["si_float","dtc","si_change"].map(k=>row(k,"setup")).join("")}
   <tr class="grp"><td colspan="5">Trigger (momentum + flow)</td></tr>${["day","d5","vs_high","rel_vol","opt_pace","net_prem","cs_skew","otm_short","gex"].map(k=>row(k,"trigger")).join("")}</table>
   <div class="muted sqnote">Risk gauge, not a confirmed squeeze. Short interest is biweekly and lagged (as of ${S.si_date||"n/a"}); hover a date for its source. Missing factors are skipped, never estimated. Borrow fee not included (no free source).<br>Method: score = √(setup × trigger), capped at 39 unless setup ≥40 and trigger ≥25, and at 59 unless setup ≥60 and trigger ≥40. Pts = factor scaled 0-100 between the thresholds in <a href="https://github.com/bobbyfarrell20/options-flow-dashboard/blob/main/scripts/squeeze.py" target="_blank" rel="noopener">squeeze.py</a>.</div></details></div>`}
function radar(){const el=$("#sqRadar");const T=D&&D.squeeze&&D.squeeze.tickers;if(!el)return;if(!T){el.style.display="none";return}el.style.display="";
  const rows=Object.entries(T).sort((a,b)=>(b[1].score??-1)-(a[1].score??-1));const hi=rows.filter(r=>r[1].score>=40).length;
  $("#sqrMeta").innerHTML=`${hi?`<b>${hi}</b> at 40+`:"None at 40+ (no badges shown)"} · short interest as of ${rows.map(r=>r[1].si_date).filter(Boolean).sort().pop()||"n/a"} · <span class="info" title="${SQ_INFO}">ⓘ</span>`;
  $("#sqrBody").innerHTML=rows.map(([t,S])=>`<div class="sqr ${st.tk.size===1&&st.tk.has(t)?"sel":""}" data-t="${t}" title="${t}: ${S.score??"n/a"}/100 · setup ${S.setup??"–"} · trigger ${S.trigger??"–"} · click for Ticker detail">
     <span class="sqr-t">${t}</span><span class="sqr-g ${sqZone(S.score)}">${gauge(S.score||0)}</span>
     <div class="sqr-trk"><i class="${sqZone(S.score)}" style="width:${S.score??0}%"></i><b style="left:40%"></b><b style="left:60%"></b></div><span class="sqr-v ${sqZone(S.score)}">${S.score??"–"}</span>
     <span class="sqr-st"><i style="width:${S.setup??0}%"></i></span><span class="sqr-st tr"><i style="width:${S.trigger??0}%"></i></span></div>`).join("");
  el.querySelectorAll(".sqr").forEach(e=>e.onclick=()=>{pick(e.dataset.t);const d=$("#tkDetail");d&&d.scrollIntoView({block:"center",behavior:"smooth"})})}
// ---------- earnings (data/earnings.json via flow.json "earnings"; refreshed daily; unknown -> no badge) ----------
const etToday=()=>new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"});
const dayDiff=(a,b)=>Math.round((Date.parse(b+"T12:00:00Z")-Date.parse(a+"T12:00:00Z"))/864e5);
const md=d=>d?`${+d.slice(5,7)}/${+d.slice(8,10)}`:"";
function erInfo(t){const E=D&&D.earnings&&D.earnings.tickers&&D.earnings.tickers[t];if(!E)return null;const today=etToday();
  const src=e=>e.source||(E.sources||[]).join(" + ")||"Yahoo";
  const status=e=>e.estimated===true?"estimated (not confirmed)":e.estimated===false?"confirmed":"listed on calendar, not confirmed";
  const base=e=>`Earnings ${e.date}${e.timing?" "+(e.timing==="BMO"?"before market open (BMO)":"after market close (AMC)"):" (timing not published)"} · ${status(e)} · source: ${(E.sources||[]).length>1?E.sources.join(" + ")+" (dates agree)":src(e)}${e.timing_source&&e.timing_source!==e.source?" · timing from "+e.timing_source:""}${E.conflict?" · note: "+E.conflict:""}`;
  if(E.next){const d=dayDiff(today,E.next.date);
    if(d===0&&E.next.timing==="BMO")return{kind:"rep",d:0,e:E.next,date:E.next.date,label:`Reported today BMO`,tip:base(E.next)};
    if(d>=0&&d<=7)return{kind:"next",d,e:E.next,date:E.next.date,label:`ER ${d===0?"today":d===1?"tmrw":md(E.next.date)}${E.next.timing?" "+E.next.timing:""}${E.next.estimated===false?"":" est."}`,tip:base(E.next)+` · in ${d} day${d===1?"":"s"}`}}
  if(E.last){const d=dayDiff(E.last.date,today);if(d>=0&&d<=1)return{kind:"rep",d,e:E.last,date:E.last.date,label:`Reported ${d?"yesterday":"today"}${E.last.timing?" "+E.last.timing:""}`,tip:base(E.last)}}
  return null}
function er(t,compact){const x=erInfo(t);if(!x)return"";const cls=x.kind==="rep"?"rep":x.d<=2?"hot":"";
  const lab=compact?(x.kind==="rep"?"ER "+(x.d?"1d ago":"today"):x.d===0?"ER today":"ER in "+x.d+"d"):x.label;
  return ` <span class="ertag ${cls} ${x.e.estimated===false?"":"est"}" title="${x.tip}">📅 ${lab}</span>`}
function erDate(t){const E=D&&D.earnings&&D.earnings.tickers&&D.earnings.tickers[t];return E?[E.next,E.last].filter(Boolean).map(e=>({date:e.date,e})):[]}
function vb0(t){const x=tick(t),v=x&&x.vol_vs_avg;if(!v||!v.flag)return"";
  const tip=`Options volume ${n(v.today)} contracts (all expirations, session ${v.session_date}) vs ${v.baseline_days}-session avg ${n(v.baseline)} (OCC). Raw ratio ${v.ratio}x`+(v.basis==="pace"?`; pace ratio ${v.pace_ratio}x = raw ÷ ${(v.session_fraction*100).toFixed(0)}% of session elapsed (assumes even volume through the day; early-session pace overstates).`:v.basis==="full session"?" (full session).":` (${v.basis}).`)+` Badge at ≥1.5x, strong at ≥3x.`;
  const ex=erInfo(t);const tip2=ex&&ex.kind==="next"?tip+" · Earnings within 7 days ("+ex.date+(ex.e.timing?" "+ex.e.timing:"")+") — elevated volume may be earnings-related.":ex&&ex.kind==="rep"?tip+" · Earnings reported "+(ex.d?"yesterday":"today")+" — elevated volume is likely earnings-related.":tip;
  return ` <span class="vb ${v.flag}" title="${tip2}">🔥${v.flag_ratio.toFixed(1)}x</span>`}
function chips(){
  const c=$("#chips");c.innerHTML=`<button class="chip ${st.tk.size?"":"on"}" data-t="ALL">All watchlist</button>`+WATCH.map(t=>{const x=tick(t);const ch=x&&x.change_pct!=null?x.change_pct:null;
    return `<button class="chip ${st.tk.has(t)?"on":""} ${x&&x.status==="ok"?"":"bad"}" data-t="${t}" title="${x?(x.name||x.message||""):""}">${t}${vb(t,1)}${ch!=null?`<span class="d ${ch>=0?"C":"P"}">${ch>=0?"+":""}${ch.toFixed(1)}%</span>`:""}</button>`}).join("");
  c.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{const t=b.dataset.t;if(t==="ALL")st.tk.clear();else st.tk.has(t)?st.tk.delete(t):st.tk.add(t);chips();board();render();detail(t==="ALL"?null:t)});
}
function leaders(){
  const s=D.summary,row=t=>{const x=tick(t);return `<div data-t="${t}"><b>${t}</b> <span class="muted">${x.bias_score>0?"+":""}${x.bias_score} · P/C ${x.pc_vol??"–"}</span></div>`};
  $("#leaders").innerHTML=`<div class="lead"><div><h4 class="g">Bullish tilt</h4>${s.bullish.map(row).join("")||'<span class="muted">none</span>'}</div><div><h4 class="r">Bearish tilt</h4>${s.bearish.map(row).join("")||'<span class="muted">none</span>'}</div></div><div class="muted" style="margin-top:6px;font-size:11px">Score = (inferred bullish − bearish premium) ÷ total, across all session-traded contracts. Inferred, not confirmed.</div>`;
  $("#leaders").querySelectorAll("[data-t]").forEach(e=>e.onclick=()=>pick(e.dataset.t));
}
function overview(){
  $("#overview").innerHTML=`<tr><th>Tkr</th><th>Spot</th><th>P/C vol</th><th>Call $</th><th>Put $</th><th>Max pain</th></tr>`+WATCH.map(t=>{const x=tick(t);
    if(!x||x.status!=="ok")return `<tr data-t="${t}"><td><b>${t}</b></td><td colspan="5" class="muted">${x?(x.message||"no options data"):"no data"}</td></tr>`;
    return `<tr data-t="${t}"><td><b>${t}</b>${vb(t,1)}${x.name_ok?"":' <span class="warn">⚠</span>'}</td><td>${x.spot}</td><td class="${x.pc_vol>1?"P":"C"}">${x.pc_vol??"–"}</td><td>${money(x.call_premium)}</td><td>${money(x.put_premium)}</td><td>${x.max_pain??"–"}</td></tr>`}).join("");
  $("#overview").querySelectorAll("tr[data-t]").forEach(e=>e.onclick=()=>pick(e.dataset.t));
}
document.addEventListener("click",e=>{const b=e.target.closest&&e.target.closest(".sqtag[data-sq]");if(b){e.stopPropagation();e.preventDefault();pick(b.dataset.sq);const d=document.querySelector(".sqpanel");d&&d.scrollIntoView({block:"nearest",behavior:"smooth"})}},true);
function pick(t){st.tk=new Set([t]);chips();board();render();radar();detail(t)}
function detail(t){
  if(!t){$("#tkTitle").textContent="Ticker detail";$("#tkDetail").innerHTML='<span class="muted">Pick a ticker chip to see details.</span>';return}
  const x=tick(t);$("#tkTitle").textContent=`${t} · ${x&&x.name?x.name:""}`;
  if(!x||x.status!=="ok"){$("#tkDetail").innerHTML=`<span class="muted">No options data${x&&x.message?": "+x.message:""}</span>`;return}
  const tot=x.call_premium+x.put_premium,pct=tot?x.call_premium/tot*100:50;
  $("#tkDetail").innerHTML=`
   <div class="kv"><span>Spot</span><span>$${x.spot} <span class="${x.change_pct>=0?"C":"P"}">${x.change_pct>=0?"+":""}${x.change_pct}%</span></span></div>
   <div style="margin-top:8px" class="muted">Call vs put premium (est.)</div><div class="bar"><i style="width:${pct}%"></i></div>
   <div class="kv"><span>Call premium</span><span class="C">$${money(x.call_premium)}</span><span>Put premium</span><span class="P">$${money(x.put_premium)}</span>
   <span>P/C ratio (volume)</span><span>${x.pc_vol??"–"}</span><span>P/C ratio (OI)</span><span>${x.pc_oi??"–"}</span>
   <span>Call / put volume</span><span>${n(x.call_vol)} / ${n(x.put_vol)}</span>
   <span>Max pain (${x.nearest_expiry})</span><span>$${x.max_pain}</span>
   <span>Approx. net GEX ($ per 1% move)</span><span class="${x.gex_total>=0?"C":"P"}">${x.gex_total>=0?"+":""}$${money(x.gex_total)}</span>
   <span>Unusual contracts</span><span>${x.unusual_count}</span>
   <span>Expiries scanned</span><span>${x.expiries_scanned} (${n(x.contracts)} contracts)</span></div>${sqPanel(t)}
   <div style="margin-top:8px" class="muted">Top strikes by open interest</div>
   <div class="kv">${x.top_oi.map(o=>`<span><span class="${o.cp}">${o.cp}</span> $${o.strike}</span><span>${n(o.oi)}</span>`).join("")}</div>
   <div style="margin-top:8px" class="muted">Largest GEX strikes (approx.)</div>
   <div class="kv">${x.gex_top.map(o=>`<span>$${o.strike}</span><span class="${o.gex>=0?"C":"P"}">${money(o.gex)}</span>`).join("")}</div>
   ${x.name_ok?"":`<div class="warn">⚠ ${x.message}</div>`}`;
}
function rows(){
  return D.flow.filter(r=>{
    if(st.tk.size&&!st.tk.has(r.ticker))return false;
    if(st.cp!=="all"&&r.cp!==st.cp)return false;
    if(st.sent!=="all"&&r.sentiment!==st.sent)return false;
    if(r.premium<st.minPrem)return false;
    if(st.dte==="61+"){if(r.dte<=60)return false}else if(r.dte>+st.dte)return false;
    if(st.unusual&&!r.unusual)return false;if(st.otm&&!r.otm)return false;
    if(st.q&&!(r.symbol+" "+r.strike).toLowerCase().includes(st.q))return false;return true;
  }).sort((a,b)=>{let x=a[st.sort],y=b[st.sort];x=x??-1;y=y??-1;return (x>y?1:x<y?-1:0)*st.dir});
}
// Row shading: color = inferred sentiment, intensity (1-5) = conviction from premium (log scale) + nearness of expiry.
// Conviction = premium score x expiry score (both must be high), ranked by percentile across ALL directional
// rows in the loaded snapshot (not the filtered view), so a row keeps its shade when filters change.
const dirn=r=>r.sentiment==="bullish"||r.sentiment==="bearish";
function cscore(r){const p=Math.min(1,Math.max(0,(Math.log10(Math.max(r.premium,1))-4)/3)); // $10K..$10M, log scale
  return p*Math.exp(-(r.dte||0)/20)}                                                          // 0 DTE = 1, 14 DTE ~0.5, 60 DTE ~0.05
let CUTS=null,CUTS_FOR=null;
function cuts(){if(CUTS_FOR===D)return CUTS;const v=D.flow.filter(dirn).map(cscore).sort((a,b)=>b-a),q=f=>v[Math.max(0,Math.ceil(v.length*f)-1)]??Infinity;
  CUTS=[q(.03),q(.10),q(.25),q(.50)];CUTS_FOR=D;return CUTS}   // top 3% / next 7% / next 15% / next 25% / rest
function conv(r){const c=cuts(),x=cscore(r);let s=x>=c[0]?5:x>=c[1]?4:x>=c[2]?3:x>=c[3]?2:1;
  if(s>=4&&(r.dte||0)>14)s=3;   // vivid steps are reserved for short-dated trades
  return s}
function rowCls(r){return r.sentiment==="bullish"||r.sentiment==="bearish"?`${r.sentiment} i${conv(r)}`:"neutral"}
function rowTip(r){return r.sentiment==="bullish"||r.sentiment==="bearish"?`Inferred ${r.sentiment} · conviction ${conv(r)}/5 (premium + days to expiry)`:"Neutral / mid / unknown side"}
function render(){
  const R=rows(),tb=$("#flow tbody");
  tb.innerHTML=R.slice(0,600).map(r=>`<tr class="${rowCls(r)}" title="${rowTip(r)}">
   <td>${tfmt(r.time)}</td><td class="tk">${r.ticker}</td><td>${r.expiry} <span class="muted">${r.dte}d</span></td><td>${r.strike}</td><td class="cpx">${r.cp==="C"?"CALL":"PUT"}</td>
   <td class="sidex">${{ask:"Ask",bid:"Bid",mid:"Mid",na:"–"}[r.side]}</td><td>${r.spot}</td><td>${r.last.toFixed(2)} <span class="muted">${r.bid.toFixed(2)}/${r.ask.toFixed(2)}</span></td>
   <td>${n(r.vol)}</td><td class="prem ${r.premium>=1e6?"big":""}">$${money(r.premium)}</td><td>${n(r.oi)}</td><td>${r.vol_oi==null?"–":r.vol_oi>=999?"new":r.vol_oi.toFixed(2)}</td><td>${r.iv.toFixed(1)}%</td>
   <td>${r.tags.map(t=>`<span class="tag ${t.split(" ")[0]}">${t}</span>`).join("")}</td></tr>`).join("");
  $("#count").textContent=`${R.length} contracts match${R.length>600?" (showing top 600)":""} · sorted by ${st.sort}`;
}
function seg(id,key){document.querySelectorAll(id+" button").forEach(b=>b.onclick=()=>{document.querySelectorAll(id+" button").forEach(x=>x.classList.remove("on"));b.classList.add("on");st[key]=b.dataset.v;render()})}
seg("#cpSeg","cp");seg("#sentSeg","sent");
$("#minPrem").onchange=e=>{st.minPrem=+e.target.value;render()};$("#dteSel").onchange=e=>{st.dte=e.target.value;render()};
$("#unusualOnly").onchange=e=>{st.unusual=e.target.checked;render()};$("#otmOnly").onchange=e=>{st.otm=e.target.checked;render()};
$("#search").oninput=e=>{st.q=e.target.value.toLowerCase();render()};
document.querySelectorAll("#flow th[data-k]").forEach(th=>th.onclick=()=>{const k=th.dataset.k;st.dir=st.sort===k?-st.dir:-1;st.sort=k;render()});
const rb=$("#refreshBtn");
rb.onclick=async()=>{if(rb.disabled)return;const prev=D&&D.generated_at;rb.disabled=true;rb.classList.add("spin");rb.querySelector(".lb").textContent="Loading…";
  const ok=await load();rb.classList.remove("spin");
  rb.querySelector(".lb").textContent=!ok?"Failed":(D.generated_at!==prev?"Updated":"Up to date");
  setTimeout(()=>{rb.querySelector(".lb").textContent="Refresh";rb.disabled=false},2000)};
load();setInterval(load,5*60*1000);
