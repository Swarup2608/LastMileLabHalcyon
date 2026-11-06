/* eslint-disable */
// @ts-nocheck
// The Command center: network map, today, pick waves, alerts and the order Pipeline.
import { donut } from "@/components/portal/charts";
import { ic } from "@/components/portal/icons";
import { viewPath } from "@/lib/portal/types";
import { enter, esc } from "@/lib/portal/utils/dom";
import { pctOf } from "@/lib/portal/utils/format";

export function createAdminOverview(ctx){
const {S,WHS,chanChip,dayOf,events,flagChips,fmtD,fmtDay,fmtT,last24,netMap,orders,rules,runTotals,simulationTableHtml,st,weekReportHtml,weekReports,whCity}=ctx;
const COLS=[['Inbox','tray'],['Address check','map-pin'],['Wave queue','clock'],['Picking','warehouse'],['At dock','package'],['In transit','truck'],['Out for delivery','map-trifold'],['Delivered','check-circle']];
const colOf=o=>o.stage<=1?0:o.stage===2?(o.held?1:0):o.stage-1;
// On /portal the overview is the live picture; the Simulation page (param 'simulation') adds the week reports and the
// Whole simulation table (simulationTable.ts).
return {
  shell(){return `<div class="page-h"><div><p class="kick">${fmtDay(ctx.simNow)}</p><h1>Command center</h1><p>Every order from the moment it lands, across 5 warehouses and 6 carriers.</p></div>
    <div class="acts">${S.user.canEditRules?`<button class="btn btn-secondary" type="button" data-go="rules">${ic('sliders-horizontal')}Rules</button>`:''}<button class="btn btn-cta" type="button" data-go="exceptions">${ic('warning')}Exceptions</button></div></div>
    ${S.user.canEditRules?'<div class="rules-strip" data-rulestrip></div>':''}
    <div class="cc">
      <section class="card" aria-label="Live network"><div class="card-h">${ic('globe-simple')}Live network<span class="r"><span class="legend"><span><i style="background:var(--blue)"></i>In transit</span><span><i style="background:var(--s6)"></i>Out for delivery</span><span><i style="background:var(--bad)"></i>Delayed</span><span><i style="background:var(--orange)"></i>Carrier D</span></span></span></div>
        <div class="map-wrap">${netMap('net','Live shipments between Halcyon warehouses and clients')}<div class="map-float" data-mapfloat></div></div></section>
      <div class="side-stack">
        <section class="card ontime" data-ontime></section>
        <section class="card" aria-label="Today"><div class="card-h">${ic('list-checks')}Today</div><ul class="today">
          ${[['rcv','Orders today','tray','--blue'],['held','Held at address check','map-pin','--warn'],['rescued','Saved by afternoon wave','lightning','--primary'],['alerts','Delay alerts sent','bell-ringing','--bad'],['chases','Clients chasing','chat-circle-text','--s4']].map(([k,l,i,c])=>`<li style="--c:var(${c})"><span class="kpi-ic">${ic(i)}</span><span class="t"><span class="lbl">${l}</span><span class="note" data-kn="${k}"></span></span><span class="val" data-k="${k}">0</span></li>`).join('')}
        </ul></section>
      </div>
    </div>
    <div class="cc2">
      <section class="card" aria-label="Pick waves today"><div class="card-h">${ic('clock')}Pick waves today<span class="r"><span class="legend"><span><i style="background:var(--s3)"></i>Morning wave</span><span><i style="background:var(--s2)"></i>Afternoon wave</span><span><i style="background:var(--s7)"></i>Carrier pickup</span><span><i style="background:var(--bad)"></i>Now</span></span></span></div><div class="sched" data-sched></div></section>
      <section class="card" aria-label="System alerts"><div class="card-h">${ic('bell-ringing')}System alerts<span class="r"><a href="${viewPath('exceptions')}" data-go="exceptions">Exceptions</a></span></div><ul class="al" data-alerts></ul></section>
    </div>
    ${S.param==='simulation'?`<div data-reports style="display:grid;gap:16px"></div>
    <section class="card" aria-label="Whole simulation" data-run></section>`:''}
    <section class="card" aria-label="Order pipeline"><div class="card-h">${ic('arrows-left-right')}Pipeline<span class="r muted" style="font-size:12px;line-height:16px">Select a card to open the order</span></div><div class="board-wrap" style="padding:0 16px 16px"><div class="board">
      ${COLS.map(([n,i],ci)=>`<div class="col" data-col="${ci}" style="--c:var(--s${ci})"><div class="col-head"><span class="col-ic">${ic(i)}</span>${n}<span class="n" data-count>0</span></div><div class="col-list" data-list></div><div class="more" data-more></div></div>`).join('')}
    </div></div></section>`},
  mount(main){this.root=main;this.cols=[...main.querySelectorAll('[data-col]')];this.els=new Map();this.first=true;this.sSig='';this.aSig=''},
  update(){
    const R=this.root;if(!R||!R.isConnected)return;
    const s=st(dayOf(ctx.simNow)),l=last24(),run=S.param==='simulation'?runTotals():null;
    const set=(k,v,n)=>{const e=R.querySelector(`[data-k="${k}"]`),m=R.querySelector(`[data-kn="${k}"]`);if(e&&e.textContent!==String(v))e.textContent=v;if(m&&m.textContent!==n)m.textContent=n};
    set('rcv',s.rcv,`${s.email} by email`);
    set('held',orders.filter(o=>o.held).length,`${s.held} caught before picking`);
    // Which rules are off is admin-only; contributors get the plain note.
    const ruleOff=k=>S.user.canEditRules&&!rules[k];
    set('rescued',s.rescued,ruleOff('afternoonWave')?'afternoon wave is off':'after 08:00, shipped today');
    set('alerts',s.alerts,ruleOff('delayAlerts')?'alerts are off':'before the client asked');
    set('chases',s.chases,s.chases?'emails asking for status':'nobody chasing');
    const p=l.del?l.on/l.del:0,ot=`<div class="donut-w">${donut(p,112,'var(--ok)')}<div class="v">${l.del?Math.round(p*100)+'%':'–'}<small>on time</small></div></div><div><h3>On time, last 24h</h3><p>${l.on} of ${l.del} delivered inside the promise.${run?` Whole simulation: <b>${pctOf(run.ontime,run.del)}</b> (${run.ontime} of ${run.del}).`:''} Baseline was 71%; industry benchmark 94%.</p></div>`;
    const oe=R.querySelector('[data-ontime]');if(oe.dataset.h!==ot){oe.dataset.h=ot;oe.innerHTML=ot}
    const tr=orders.filter(o=>o.stage===6),out=orders.filter(o=>o.stage===7),dl=orders.filter(o=>o.flags.delay&&o.stage<8);
    const mf=`<div><b>${tr.length}</b><span>In transit</span></div><div><b>${out.length}</b><span>Out for delivery</span></div><div><b style="color:var(--bad)">${dl.length}</b><span>Delayed</span></div>`;
    const me=R.querySelector('[data-mapfloat]');if(me.dataset.h!==mf){me.dataset.h=mf;me.innerHTML=mf}
    // Admins only: contributors don't get the rules strip.
    const strip=R.querySelector('[data-rulestrip]');if(strip){const rs=[['addressCheck','Address check'],['afternoonWave','Afternoon wave'],['weeklyAllocation','Weekly allocation'],['avoidD','Avoid D'],['delayAlerts','Delay alerts']].map(([k,lb])=>`<span class="chip ${rules[k]?'ok':'bad'}">${rules[k]?ic('check'):ic('x')}${lb}</span>`).join('');
    if(strip.dataset.s!==rs){strip.dataset.s=rs;strip.innerHTML=`<span>Active rules</span>${rs}`}}
    // Week reports only change when a week ends, so a report folded away stays folded.
    const rp=R.querySelector('[data-reports]');if(rp&&rp.dataset.n!==String(weekReports.length)){rp.dataset.n=String(weekReports.length);rp.innerHTML=weekReports.map((r,i)=>weekReportHtml(r,i===0)).join('')}
    const re=R.querySelector('[data-run]');if(re){const rh=simulationTableHtml();if(re.dataset.h!==rh){re.dataset.h=rh;re.innerHTML=rh}}
    // schedule
    const d=dayOf(ctx.simNow),x=t=>Math.max(0,Math.min(100,((t-d*1440)-360)/840*100));
    const sched=WHS.map(w=>{const mine=orders.filter(o=>o.wh===w.id&&o.waveAt&&dayOf(o.waveAt)===d);const g={};mine.forEach(o=>{(g[o.waveAt]=g[o.waveAt]||[]).push(o)});
      const bars=Object.entries(g).map(([wa,list])=>{wa=+wa;const end=Math.max(wa+60,...list.map(o=>{const h5=o.hist.find(hh=>hh.stage===5);return h5?h5.t:Math.max(wa+90,o.stage>=4?ctx.simNow:wa+90)}));const aft=(wa%1440)>=840;
        return `<span class="sched-bar" style="--c:var(${aft?'--s2':'--s3'});left:${x(wa)}%;width:${Math.max(1.5,x(end)-x(wa))}%" title="${aft?'Afternoon':'Morning'} wave, ${list.length} orders">${aft?'Afternoon':'Morning'} · ${list.length}</span>`}).join('');
      return `<div class="sched-row"><span class="sched-l">${esc(whCity(w.id))}</span><div class="sched-track">${bars}<span class="sched-pick" style="left:${x(d*1440+1020)}%" title="Carrier pickup 17:00"></span><span class="sched-now" style="left:${x(ctx.simNow)}%"></span></div></div>`}).join('');
    const axis=`<div class="sched-axis"><span></span><div class="sched-ticks">${[6,8,10,12,14,16,18,20].map(hh=>`<span style="left:${(hh-6)/14*100}%">${String(hh).padStart(2,'0')}:00</span>`).join('')}</div></div>`;
    const se=R.querySelector('[data-sched]'),sh=sched+axis;if(se.dataset.h!==sh){se.dataset.h=sh;se.innerHTML=sh}
    // alerts
    const al=events.filter(e=>e.kind==='bad'||e.kind==='warn').slice(0,6);const ah=al.length?al.map(e=>`<li style="--c:var(${e.kind==='bad'?'--bad':'--warn'})"><span class="ai">${ic(e.kind==='bad'?'bell-ringing':'warning')}</span><span class="tx">${esc(e.text)}<br><a href="${viewPath('order',e.id)}" data-order="${e.id}">${e.id}</a></span><span class="tm">${fmtT(e.t)}</span></li>`).join(''):`<li class="empty" style="display:grid">${ic('check-circle','lg')}All clear.</li>`;
    const ae=R.querySelector('[data-alerts]');if(ae.dataset.h!==ah){ae.dataset.h=ah;ae.innerHTML=ah}
    // board
    const groups=COLS.map(()=>[]);for(const o of orders)groups[colOf(o)].push(o);
    groups.forEach((g,ci)=>{g.sort((a,b)=>b.lastT-a.lastT);const col=this.cols[ci],list=col.querySelector('[data-list]'),shown=g.slice(0,4);
      const cnt=col.querySelector('[data-count]');if(cnt.textContent!==String(g.length))cnt.textContent=g.length;
      shown.forEach((o,i)=>{const el=this.card(o,ci);if(list.children[i]!==el)list.insertBefore(el,list.children[i]||null)});
      while(list.children.length>shown.length)list.lastChild.remove();
      const more=col.querySelector('[data-more]'),mt=g.length>4?`+${g.length-4} more`:(g.length?'':'Nothing here right now');if(more.textContent!==mt)more.textContent=mt});
    this.first=false;
  },
  card(o,ci){let el=this.els.get(o.id);
    if(!el){el=document.createElement('button');el.type='button';el.className='ocard';el.dataset.order=o.id;this.els.set(o.id,el)}
    const sig=o.stage+'|'+o.held+'|'+JSON.stringify(o.flags)+o.carrier;
    if(el.dataset.sig!==sig){el.dataset.sig=sig;el.innerHTML=`<span class="ocard-top"><span class="ocard-id">${o.id}</span>${chanChip(o)}</span><span class="ocard-client">${esc(o.client.name)}</span><span class="ocard-flags">${flagChips(o)}</span><span class="muted">${o.promiseEnd?(o.stage===8?`Delivered ${fmtT(o.deliveredAt)}`:`Due ${fmtD(o.promiseEnd)}`):`Arrived ${fmtT(o.arrival)}`}</span>`}
    if(el.dataset.col!==String(ci)){el.dataset.col=ci;el.style.setProperty('--c',`var(--s${ci})`);if(!this.first)enter(el)}
    return el}
};

}
