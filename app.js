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
  chips();board();leaders();overview();render();if(st.tk.size===1)detail([...st.tk][0]);return true;
}
function volNote(){const m=D.volume_meta;if(!m)return"";const ok=D.tickers.filter(t=>t.vol_vs_avg&&t.vol_vs_avg.baseline_days>=m.min_days).length;
  const fl=D.tickers.filter(t=>t.vol_vs_avg&&t.vol_vs_avg.flag).map(t=>t.ticker);
  return ok?` 🔥 = options volume ≥1.5x (strong ≥3x) its ${m.lookback}-session average daily options volume from OCC (pace-adjusted intraday; hover a badge for details). Flagged: ${fl.join(", ")||"none"}.`:" 🔥 Unusual-volume badges: baseline building (need "+m.min_days+" sessions of OCC history).";}
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
  fill("#sbBull",b.bullish);fill("#sbBear",b.bearish);
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
  $("#sbNet").querySelectorAll("tr[data-t]").forEach(e=>e.onclick=()=>{pick(e.dataset.t);document.querySelector(".tablewrap").scrollIntoView({behavior:"smooth"})});
  const src=b.side_sources||{},cached=Object.keys(src).filter(k=>src[k]==="cached"),na=Object.keys(src).filter(k=>src[k]==="unavailable");
  let extra="";if(cached.length)extra+=` Sides for ${cached.join(", ")} carried from the last in-session snapshot (current quotes are pre-market/after-hours).`;
  if(na.length)extra+=` No side data for ${na.join(", ")} (no trades yet in the current session, or quotes outside session hours).`;
  $("#sbNote").dataset.base=$("#sbNote").dataset.base||$("#sbNote").textContent;$("#sbNote").textContent=$("#sbNote").dataset.base+extra+volNote();
}
function tick(t){return D.tickers.find(x=>x.ticker===t)}
const POSITIONS=new Set(["LYFT"]); // tickers Bobby holds a position in (marker only, no details)
function pos(t){return POSITIONS.has(t)?'<span class="pos" title="You hold a position in this ticker">POS</span>':""}
function vb(t){return pos(t)+vb0(t)}
function vb0(t){const x=tick(t),v=x&&x.vol_vs_avg;if(!v||!v.flag)return"";
  const tip=`Options volume ${n(v.today)} contracts (all expirations, session ${v.session_date}) vs ${v.baseline_days}-session avg ${n(v.baseline)} (OCC). Raw ratio ${v.ratio}x`+(v.basis==="pace"?`; pace ratio ${v.pace_ratio}x = raw ÷ ${(v.session_fraction*100).toFixed(0)}% of session elapsed (assumes even volume through the day; early-session pace overstates).`:v.basis==="full session"?" (full session).":` (${v.basis}).`)+` Badge at ≥1.5x, strong at ≥3x.`;
  return ` <span class="vb ${v.flag}" title="${tip}">🔥${v.flag_ratio.toFixed(1)}x</span>`}
function chips(){
  const c=$("#chips");c.innerHTML=`<button class="chip ${st.tk.size?"":"on"}" data-t="ALL">All watchlist</button>`+WATCH.map(t=>{const x=tick(t);const ch=x&&x.change_pct!=null?x.change_pct:null;
    return `<button class="chip ${st.tk.has(t)?"on":""} ${x&&x.status==="ok"?"":"bad"}" data-t="${t}" title="${x?(x.name||x.message||""):""}">${t}${vb(t)}${ch!=null?`<span class="d ${ch>=0?"C":"P"}">${ch>=0?"+":""}${ch.toFixed(1)}%</span>`:""}</button>`}).join("");
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
    return `<tr data-t="${t}"><td><b>${t}</b>${vb(t)}${x.name_ok?"":' <span class="warn">⚠</span>'}</td><td>${x.spot}</td><td class="${x.pc_vol>1?"P":"C"}">${x.pc_vol??"–"}</td><td>${money(x.call_premium)}</td><td>${money(x.put_premium)}</td><td>${x.max_pain??"–"}</td></tr>`}).join("");
  $("#overview").querySelectorAll("tr[data-t]").forEach(e=>e.onclick=()=>pick(e.dataset.t));
}
function pick(t){st.tk=new Set([t]);chips();board();render();detail(t)}
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
   <span>Expiries scanned</span><span>${x.expiries_scanned} (${n(x.contracts)} contracts)</span></div>
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
function render(){
  const R=rows(),tb=$("#flow tbody");
  tb.innerHTML=R.slice(0,600).map(r=>`<tr class="${r.sentiment}">
   <td>${tfmt(r.time)}</td><td class="tk">${r.ticker}</td><td>${r.expiry} <span class="muted">${r.dte}d</span></td><td>${r.strike}</td><td class="${r.cp}">${r.cp==="C"?"CALL":"PUT"}</td>
   <td class="side-${r.side}">${{ask:"Ask",bid:"Bid",mid:"Mid",na:"–"}[r.side]}</td><td>${r.spot}</td><td>${r.last.toFixed(2)} <span class="muted">${r.bid.toFixed(2)}/${r.ask.toFixed(2)}</span></td>
   <td>${n(r.vol)}</td><td class="prem ${r.premium>=1e6?"big":""}">$${money(r.premium)}</td><td>${n(r.oi)}</td><td>${r.vol_oi==null?"–":r.vol_oi>=999?"new":r.vol_oi.toFixed(2)}</td><td>${r.iv.toFixed(1)}%</td>
   <td>${r.tags.map(t=>`<span class="tag ${t.split(" ")[0]}">${t}</span>`).join("")}</td></tr>`).join("");
  $("#count").textContent=`${R.length} contracts match${R.length>600?" (showing top 600)":""} · sorted by ${st.sort} · green = inferred bullish, red = inferred bearish`;
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
