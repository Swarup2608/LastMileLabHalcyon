/* eslint-disable */
// @ts-nocheck
// One order for operations: source, journey and route.
import { ic } from "@/components/portal/icons";
import { viewPath } from "@/lib/portal/types";
import { esc } from "@/lib/portal/utils/dom";
import { miles } from "@/lib/portal/utils/geo";

export function createAdminOrder(ctx){
const {S,WH_OF,addrText,byId,chanChip,destLL,fmtD,fmtDT,fmtT,fromLL,journeySteps,markBody,netMap,statusChip,whCity,whName}=ctx;
return {parent:'orders',
  shell(){return `<a class="back" href="${viewPath('orders')}" data-go="orders">${ic('arrow-left')}All orders</a><div data-region style="display:grid;gap:24px"></div>`},
  sig(){const o=byId(S.param);return o?o.id+o.stage+o.held+o.hist.length:'x'},
  region(){
    const o=byId(S.param);if(!o)return `<div class="card empty">${ic('package','lg')}That order has been archived.</div>`;
    let callout='';
    if(o.held)callout=`<div class="callout warn">${ic('warning')}<span>Held before it reaches the pick list, so a wrong address never ships. Fixing it now keeps today’s promise.</span></div>`;
    else if(o.flags.badAddr&&o.stage<8)callout=`<div class="callout bad">${ic('warning')}<span>Shipped with an incomplete address because the address check is off. Expect a failed delivery.</span></div>`;
    else if(o.flags.delay&&o.stage<8)callout=`<div class="callout bad">${ic('bell-ringing')}<span>Delay in ${o.hub}. ${o.flags.alerted?`${esc(o.client.contact)} was told before chasing.`:'The client has not been told.'}</span>${o.flags.alerted?'':`<button class="btn btn-secondary btn-sm act" type="button" data-notify="${o.id}">${ic('paper-plane-tilt')}Send alert now</button>`}</div>`;
    else if(o.flags.rescued&&o.stage>=3&&o.stage<6)callout=`<div class="callout pri">${ic('lightning')}<span>Arrived at ${fmtT(o.arrival)}, after the 08:00 cutoff. The afternoon wave still ships it today.</span></div>`;
    else if(o.stage===8)callout=`<div class="callout ${o.onTime?'ok':'bad'}">${ic(o.onTime?'check-circle':'warning')}<span>${o.onTime?'Delivered inside the promise':'Delivered after the promise'}, ${fmtDT(o.deliveredAt)}.</span></div>`;
    const src=o.channel==='email'?`<dl class="mail-meta"><dt>From</dt><dd>${esc(o.client.contact)} &lt;orders@${o.client.domain}&gt;</dd><dt>Subject</dt><dd>${esc(o.subject)}</dd><dt>Arrived</dt><dd class="mono">${fmtDT(o.arrival)}</dd></dl><pre class="mail-body">${markBody(o)}</pre>`
      :`<pre class="mail-body">${esc(JSON.stringify({po:o.po,client:o.client.name,sku:o.product.sku,qty:o.qty,ship_to:{street:o.dest.street,unit:o.held&&o.missing==='suite number'?null:o.dest.unit,city:o.dest.city,state:o.dest.st,zip:o.held&&o.missing==='ZIP code'?null:o.dest.zip}},null,2))}</pre>`;
    return `<div class="d-head"><div class="d-title"><div class="d-meta"><span class="mono">${o.id}</span>${chanChip(o)}${statusChip(o)}</div><h1>${esc(o.client.name)}</h1><div class="d-meta">${o.qty} cartons of ${esc(o.product.sku)} ${esc(o.product.name)} to ${esc(o.dest.city)}, ${o.dest.st}</div></div>
      <div class="promise"><div class="lbl">Promised delivery</div>${o.promiseEnd?`<div class="val">${fmtD(o.promiseEnd)}, 17:00</div><div class="sub">${o.flags.delay&&o.stage<8?`<span class="late">New estimate ${fmtD(o.outAt)}</span>`:o.stage===8?(o.onTime?'Kept':'Missed'):o.waveName}</div>`:`<div class="val">Not set yet</div><div class="sub">${o.held?'Waiting on the address':'Set once the address passes'}</div>`}</div></div>
      ${callout}
      <div class="cols2" style="grid-template-columns:minmax(0,1fr) minmax(0,1.1fr)">
        <section class="card" aria-label="Source"><div class="card-h tint">${ic(o.channel==='email'?'envelope-simple':'plugs-connected')}${o.channel==='email'?'Original email':'Order payload'}<span class="r"><span class="chip">${o.channel==='email'?'Read automatically':'Received in the WMS'}</span></span></div>${src}
          <dl class="kv" style="border-top:1px solid var(--border)"><dt>Ship to</dt><dd>${addrText(o)}${o.held?` <span class="chip warn">${o.missing} missing</span>`:''}</dd>
          <dt>Warehouse</dt><dd>${o.wh?esc(whName(o.wh))+(o.flags.transfer?` <span class="chip warn">${esc(whCity(o.flags.transfer))} out of stock</span>`:''):'<span class="muted">After address check</span>'}</dd>
          <dt>Carrier</dt><dd>${o.carrier?`Carrier ${o.carrier}${o.flags.avoidedD?' <span class="chip">D avoided on this lane</span>':''}`:'<span class="muted">Chosen at planning</span>'}</dd></dl></section>
        <section class="card" aria-label="Journey"><div class="card-h tint">${ic('list-checks')}Journey<span class="r"><span class="chip">${o.hist.length} events</span></span></div><ol class="steps">${journeySteps(o,true)}</ol></section>
      </div>
      <section class="card" aria-label="Route"><div class="card-h">${ic('map-trifold')}Route<span class="r"><span class="legend"><span><i style="background:var(--brand)"></i>${esc(whName(o.wh||WH_OF[o.dest.region]))}</span><span><i style="background:var(--orange)"></i>${esc(o.dest.city)}, ${o.dest.st}</span><span>${miles(fromLL(o),destLL(o)).toLocaleString('en-US')} mi</span></span></span></div><div class="map-wrap">${netMap('o:'+o.id,'Route for '+o.id)}</div></section>`}
};

}
