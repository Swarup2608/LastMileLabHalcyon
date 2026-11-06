/* eslint-disable */
// @ts-nocheck
// Pieces shared by the engine's views: status chips, the order journey, updates lists, the address alert and
// the orders table.
import { ic } from "@/components/portal/icons";
import { viewPath } from "@/lib/portal/types";
import { esc } from "@/lib/portal/utils/dom";

export function createParts(ctx){
const {dayOf,fmtD,fmtDT,fmtT,whCity}=ctx;
const VIA={email:'EMAIL',edi:'EDI',api:'API',portal:'PORTAL'};
const chanChip=o=>`<span class="chip ch">${VIA[o.channel]}</span>`;
const STAGE=['Received','Reading','Address check','Waiting for wave','Picking','At dock','In transit','Out for delivery','Delivered'];
function stageLabel(o){if(o.held)return `Needs ${o.missing}`;if(o.stage===8)return o.onTime?'Delivered':'Delivered late';if(o.stage===6&&o.flags.delay)return 'Delayed';return STAGE[o.stage]}
function tone(o){if(o.held)return 'warn';if(o.flags.delay&&o.stage<8)return 'bad';if(o.stage===8)return o.onTime?'ok':'bad';if(o.stage>=6)return 'blue';if(o.stage>=3)return 'pri';return ''}
const statusChip=o=>`<span class="chip ${tone(o)}">${stageLabel(o)}</span>`;
function flagChips(o){const f=[];
  if(o.held)f.push(`<span class="chip warn">${ic('warning')}No ${o.missing}</span>`);
  if(o.flags.rescued&&o.stage<6)f.push(`<span class="chip pri">${ic('lightning')}Afternoon wave</span>`);
  if(o.flags.delay&&o.stage<8)f.push(`<span class="chip bad">${ic('bell-ringing')}${o.flags.alerted?'Alert sent':'Not told'}</span>`);
  if(o.flags.transfer&&o.stage>=3&&o.stage<6)f.push(`<span class="chip">From ${whCity(o.wh)}</span>`);
  if(o.flags.avoidedD&&o.stage>=5&&o.stage<7)f.push(`<span class="chip">D avoided</span>`);
  if(o.carrier==='D'&&o.stage>=5&&o.stage<8)f.push(`<span class="chip warn">Carrier D</span>`);
  return f.join('')}
const MILESTONES=[['Received','tray',0],['Read and extracted','clipboard-text',0],['Address check','map-pin',7],['Promise and wave','clock',2],['Picking','warehouse',3],['Packed and booked','package',4],['In transit','truck',5],['Out for delivery','map-trifold',6],['Delivered','flag-checkered',7]];
function journeySteps(o,canFix){
  return MILESTONES.map(([name,icon,sc],i)=>{
    let state='todo';
    if(o.stage>i||(o.stage===8&&i===8))state='done';else if(o.stage===i)state=(i===2&&o.held)?'hold':'now';
    if(i===6&&o.stage===6&&o.flags.delay)state='late';
    const h=o.hist.filter(x=>x.stage===i);const at=h.length?fmtT(h[0].t):'';
    let time=at,desc='';
    if(state==='todo'){if(i===4&&o.waveAt)time=`plan ${fmtT(o.waveAt)}`;if(i===6&&o.collectAt)time=`plan ${fmtT(o.collectAt)}`;if(i===8&&o.promiseEnd)time=`by ${fmtD(o.promiseEnd)}`}
    else{desc=h.map(x=>esc(x.text)).join('. ');if(h.length&&dayOf(h[0].t)!==dayOf(o.arrival))time=`${fmtD(h[0].t).slice(0,3)} ${at}`}
    let act='';
    if(state==='hold'&&canFix){const sug=o.missing==='ZIP code'?o.dest.zip:o.dest.unit;act=`<div class="step-act"><button class="btn btn-primary btn-sm" type="button" data-fix="${o.id}" data-val="${esc(sug)}">${ic('check')}Use validated ${o.missing==='ZIP code'?'ZIP '+sug:esc(sug)}</button><span class="chip warn">${ic('envelope-simple')}Client asked at ${at}</span></div>`}
    const node=state==='done'?ic('check'):(state==='hold'||state==='late')?ic('warning'):ic(icon);
    return `<li class="step" data-state="${state}" style="--c:var(--s${sc})"><span class="node">${node}</span><span class="step-name">${name}</span><span class="step-time">${time}</span>${desc?`<span class="step-desc">${desc}</span>`:''}${act}</li>`}).join('');
}
function markBody(o){
  let s=esc(o.body);
  for(const m of [`${o.qty} cartons`,o.dest.street,o.missing==='suite number'&&o.held?null:o.dest.unit,`${o.dest.city}, ${o.dest.st}`,o.missing==='ZIP code'&&o.held?null:o.dest.zip]){if(!m)continue;const e=esc(m),i=s.indexOf(e);if(i>-1)s=s.slice(0,i)+`<mark>${e}</mark>`+s.slice(i+e.length)}
  if(o.held){const e=`<mark>${esc(o.dest.city+', '+o.dest.st)}</mark>`;s=s.replace(e,`${e} <mark class="miss">${o.missing} missing</mark>`)}
  return s;
}
const addrText=o=>`${esc(o.dest.street)}${o.held&&o.missing==='suite number'?'':', '+esc(o.dest.unit)}, ${esc(o.dest.city)}, ${o.dest.st}${o.held&&o.missing==='ZIP code'?'':' '+o.dest.zip}`;
function updatesList(list,link){return list.length?`<ol class="updates">${list.map(m=>`<li data-kind="${m.kind}"><span class="ui">${ic(m.kind==='bad'?'bell-ringing':m.kind==='warn'?'warning':m.kind==='ok'?'check-circle':'envelope-simple')}</span><div><p class="msg">${esc(m.text)}</p><p class="when">${fmtDT(m.t)}${link&&m.o?` · <a href="${viewPath('order',m.o.id)}" data-order="${m.o.id}">${m.o.id}</a>`:''}</p></div></li>`).join('')}</ol>`:`<div class="empty">${ic('bell','lg')}No updates yet.</div>`}
function addrAlert(o,compact){
  return `<section class="card alert warn" aria-label="Action needed"><div class="alert-top"><span class="alert-ic">${ic('map-pin')}</span><div><h2>Add the ${o.missing} for ${o.id}</h2><p>${esc(o.dest.street)}, ${esc(o.dest.city)}, ${o.dest.st}. We held the order instead of guessing, so it can’t go to the wrong door.</p></div></div>
    <div class="alert-form"><label class="sr" for="fix-${o.id}">${o.missing}</label><input class="input" id="fix-${o.id}" data-key="fix-${o.id}" data-fixin="${o.id}" ${o.missing==='ZIP code'?'inputmode="numeric" maxlength="5" placeholder="5 digit ZIP code" autocomplete="postal-code"':'placeholder="Suite or unit number"'}><button class="btn btn-primary" type="button" data-clientfix="${o.id}">${ic('paper-plane-tilt')}Send</button></div>
    <p class="ferr" data-fixerr="${o.id}" hidden></p></section>`;
}
function ordersTable(list,admin){
  if(!list.length)return `<div class="empty">${ic('package','lg')}No orders match.</div>`;
  return `<table class="tbl"><thead><tr><th>Order</th>${admin?'<th>Client</th>':'<th>Product</th>'}<th>Channel</th><th>Received</th><th>Status</th>${admin?'<th>Warehouse</th><th>Carrier</th>':'<th>Ship to</th>'}<th>Promise</th></tr></thead><tbody>
    ${list.map(o=>`<tr data-order="${o.id}" tabindex="0" data-key="row-${o.id}"><td><span class="id">${o.id}</span></td>
      ${admin?`<td>${esc(o.client.name)}<span class="sub">${o.qty} cartons · ${esc(o.product.sku)}</span></td>`:`<td>${esc(o.product.name)}<span class="sub">${o.qty} cartons · ${esc(o.product.sku)}</span></td>`}
      <td>${chanChip(o)}</td><td class="mono">${fmtT(o.arrival)}<span class="sub">${fmtD(o.arrival)}</span></td><td>${statusChip(o)}</td>
      ${admin?`<td>${o.wh?esc(whCity(o.wh)):'<span class="muted">Pending</span>'}</td><td>${o.carrier?'Carrier '+o.carrier:'<span class="muted">Pending</span>'}</td>`:`<td>${esc(o.dest.city)}, ${o.dest.st}</td>`}
      <td>${o.promiseEnd?(o.flags.delay&&o.stage<8?`<span style="color:var(--bad)">${fmtD(o.outAt)}</span>`:fmtD(o.promiseEnd)):'<span class="muted">Not set</span>'}</td></tr>`).join('')}</tbody></table>`;
}
const WCOL=['--s5','--s2','--s3','--s4','--s6','--s0','--s7','--s1'];
const pTot=p=>Object.values(p.stock).reduce((a,b)=>a+b,0);
return {VIA,chanChip,STAGE,stageLabel,tone,statusChip,flagChips,MILESTONES,journeySteps,markBody,addrText,updatesList,addrAlert,ordersTable,WCOL,pTot};
}
