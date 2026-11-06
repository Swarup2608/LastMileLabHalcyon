/* eslint-disable */
// @ts-nocheck
// One of the client's orders: tracking, route and updates.
import { ic } from "@/components/portal/icons";
import { viewPath } from "@/lib/portal/types";
import { esc } from "@/lib/portal/utils/dom";

export function createClientOrder(ctx){
const {S,VIA,WH_OF,addrAlert,addrText,byId,chanChip,distText,fmtD,fmtDT,fmtDay,fmtT,netMap,progress,statusChip,updatesList,whCity,whName}=ctx;
return {parent:'orders',
  shell(){return `<a class="back" href="${viewPath('orders')}" data-go="orders">${ic('arrow-left')}All orders</a><div data-region style="display:grid;gap:16px"></div>`},
  sig(){const o=byId(S.param);return o?o.id+o.stage+o.held+o.msgs.length+(S.f.ack||''):'x'},
  region(){
    const o=byId(S.param);if(!o||o.ci!==S.user.client)return `<div class="card empty">${ic('package','lg')}This order isn’t in your account.</div>`;
    const delayed=o.flags.delay&&o.stage<8;
    let alert='';
    if(o.held)alert=addrAlert(o);
    else if(delayed&&o.flags.alerted&&S.f.ack!==o.id)alert=`<section class="card alert bad"><div class="alert-top"><span class="alert-ic">${ic('bell-ringing')}</span><div><h2>Heads up, your delivery moved</h2><p>Your parcel missed a connection in ${o.hub}. We told you as soon as we knew. New estimate ${fmtDay(o.outAt)} by 5pm.</p></div></div><div class="alert-form"><button class="btn btn-secondary" type="button" data-ack="${o.id}">Thanks, got it</button></div></section>`;
    else if(o.flags.rescued&&o.stage>=3&&o.stage<=5)alert=`<section class="card alert ok"><div class="alert-top"><span class="alert-ic">${ic('lightning')}</span><div><h2>Still shipping today</h2><p>This order came in after the 08:00 cutoff. It joined the afternoon wave instead of waiting until tomorrow.</p></div></div></section>`;
    const H=s=>o.hist.find(x=>x.stage===s);
    const eta=o.stage===8?o.deliveredAt:(delayed?o.outAt:o.promiseEnd);
    const steps=[
      ['Order received',H(0),o.channel==='email'?'Read automatically from your email':o.channel==='portal'?'Placed in the portal':'Received through '+VIA[o.channel],'--s0'],
      ['Confirmed',H(3),o.held?`Waiting for the ${o.missing}`:o.waveName?`Joins the ${o.waveName}`:'Address being checked','--s2'],
      ['Packed',H(5),o.wh?`At ${whName(o.wh)}`:'','--s3'],
      ['Shipped',H(6),o.carrier?`With Carrier ${o.carrier}`:'','--s5'],
      ['Out for delivery',H(7),'On the driver’s route today','--s6'],
      ['Delivered',H(8),o.stage===8?(o.onTime?'Delivered on time':'Delivered after the promise'):(eta?`Expected ${fmtD(eta)} by 17:00`:'Date set once confirmed'),'--s7'],
    ];
    let lastDone=-1;steps.forEach((s,i)=>{if(s[1])lastDone=i});
    const tl=steps.map((s,i)=>{const done=!!s[1];const c=delayed&&i===3?'--bad':o.held&&i===1?'--warn':s[3];
      const when=done?`${fmtD(s[1].t).slice(4)}<small>${fmtT(s[1].t)}</small>`:(i===5&&eta?`${fmtD(eta).slice(4)}<small>est.</small>`:'<small>–</small>');
      return `<li style="--c:var(${c})"${done?'':' data-future'}${i>=lastDone?' data-next':''}><span class="d">${when}</span><span class="b"></span><span class="x">${s[0]}<small>${esc(s[2])}</small></span></li>`}).join('');
    const pr=progress(o),segs=5,on=Math.floor(pr*segs);
    return `${alert}<div class="trk">
      <section class="card trk-info" aria-label="Order details">
        <div><div style="display:flex;gap:8px;flex-wrap:wrap">${statusChip(o)}${chanChip(o)}</div><div class="trk-id" style="margin-top:12px">${o.id}</div><p class="trk-sub">PO ${esc(o.po)} · ${o.qty} cartons of ${esc(o.product.name)}</p></div>
        <dl class="trk-meta"><div><dt>Placed</dt><dd class="mono">${fmtDT(o.arrival)}</dd></div><div><dt>Carrier</dt><dd>${o.carrier?'Carrier '+o.carrier:'Assigned once confirmed'}</dd></div>
          <div style="grid-column:1/-1"><dt>Delivery address</dt><dd>${addrText(o)}</dd></div><div><dt>Ships from</dt><dd>${o.wh?esc(whName(o.wh)):'After the address check'}</dd></div><div><dt>Item</dt><dd>${esc(o.product.sku)}</dd></div></dl>
        <div><h3 style="margin-bottom:16px">Status</h3><ol class="tl">${tl}</ol></div>
      </section>
      <section class="card trk-map" aria-label="Route map"><div class="card-h">${ic('map-trifold')}Route<span class="r"><span class="legend"><span><i style="background:var(--brand)"></i>${esc(whCity(o.wh||WH_OF[o.dest.region]))}</span><span><i style="background:${delayed?'var(--bad)':'var(--orange)'}"></i>${esc(o.dest.city)}</span></span></span></div>
        <div class="map-wrap">${netMap('o:'+o.id,'Route from '+whName(o.wh||WH_OF[o.dest.region])+' to '+o.dest.city)}</div>
        <div class="truckcard"><div class="row"><span class="tk">${ic('truck','lg')}</span><div><strong style="font-size:16px;line-height:24px">${o.carrier?'Carrier '+o.carrier:'Not booked yet'}</strong><p class="muted" style="font-size:12px;line-height:16px">${o.stage>=6&&o.stage<8?'In motion':o.stage===8?'Completed':'Waiting at warehouse'}</p></div></div>
          <div class="pdots${delayed?' bad':''}">${Array.from({length:segs},(_,i)=>`<i class="${i<on?'on':i===on&&o.stage<8?'now':''}"></i>`).join('')}</div>
          <dl><div><dt>Distance</dt><dd class="mono">${distText(o)}</dd></div><div><dt>${o.stage===8?'Delivered':'Arrives'}</dt><dd>${eta?fmtD(eta):'To be set'}</dd></div></dl></div>
      </section></div>
      <section class="card"><div class="card-h">${ic('bell')}Updates sent to you</div>${updatesList(o.msgs.slice().reverse())}</section>`}
};

}
