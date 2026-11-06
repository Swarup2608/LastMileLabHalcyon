/* eslint-disable */
// @ts-nocheck
// The client's Overview: active delivery, on time, recent orders, updates and stock.
import { donut } from "@/components/portal/charts";
import { ic } from "@/components/portal/icons";
import { viewPath } from "@/lib/portal/types";
import { esc } from "@/lib/portal/utils/dom";
import { miles } from "@/lib/portal/utils/geo";

export function createClientOverview(ctx){
const {CLIENTS,PRODUCTS,S,WHS,addrAlert,byId,cs,dayOf,destLL,fmtDay,fromLL,lowAny,myOrders,netMap,ordersTable,progress,statusChip,updatesList}=ctx;
return {
  shell(){const h=Math.floor((ctx.simNow%1440)/60);return `<div class="page-h"><div><p class="kick">${fmtDay(ctx.simNow)}</p><h1>Good ${h<12?'morning':h<17?'afternoon':'evening'}, ${esc(S.user.name.split(' ')[0])}</h1><p>${esc(CLIENTS[S.user.client].name)} · every order shipping with Halcyon, live.</p></div>
    <div class="acts"><button class="btn btn-secondary" type="button" data-compose>${ic('envelope-simple')}Email an order</button><button class="btn btn-cta" type="button" data-go="new">${ic('plus')}New order</button></div></div><div data-region style="display:grid;gap:16px"></div>`},
  active(){const m=myOrders();return m.filter(o=>(o.stage===6||o.stage===7)&&miles(fromLL(o),destLL(o))>60).sort((a,b)=>b.stage-a.stage||a.promiseEnd-b.promiseEnd)[0]||m.filter(o=>o.stage===6||o.stage===7)[0]||m.filter(o=>o.stage<8).sort((a,b)=>b.stage-a.stage)[0]||null},
  sig(){const m=myOrders();const a=this.active();return m.map(o=>o.id+o.stage+o.held+o.msgs.length).join()+(a?a.id:'')+PRODUCTS.filter(p=>p.client===S.user.client).map(p=>Object.values(p.stock).join('.')).join()},
  region(){
    const m=myOrders(),open=m.filter(o=>o.stage<8),held=m.filter(o=>o.held);
    const today=dayOf(ctx.simNow),arriving=open.filter(o=>o.promiseEnd&&dayOf(o.flags.delay?o.outAt:o.promiseEnd)<=today+1).length;
    const c=cs(S.user.client);const a=this.active();
    const recent=m.slice().sort((x,y)=>y.arrival-x.arrival).slice(0,5);
    const msgs=m.flatMap(o=>o.msgs.map(x=>({...x,o}))).sort((x,y)=>y.t-x.t).slice(0,5);
    const prods=PRODUCTS.filter(p=>p.client===S.user.client),maxT=Math.max(...prods.map(p=>Object.values(p.stock).reduce((s,v)=>s+v,0)));
    const ad=a?(()=>{const dist=miles(fromLL(a),destLL(a)),pr=progress(a);
      return `<section class="card ad" aria-label="Active delivery"><div class="ad-info">
        <div><p class="kick">${a.stage>=6?'Active delivery':'Next up'}</p><h2>${esc(a.product.name)}</h2><p class="muted" style="font-size:14px;line-height:20px"><a class="mono" href="${viewPath('order',a.id)}" data-order="${a.id}">${a.id}</a> · ${statusChip(a)}</p></div>
        <div class="ad-stats"><div class="ad-stat"><b>${a.qty}</b><span>Cartons</span></div><div class="ad-stat"><b>${dist.toLocaleString('en-US')}</b><span>Miles</span></div><div class="ad-stat"><b data-prog="${a.id}">${Math.round(pr*100)}%</b><span>Progress</span></div></div>
        <div class="ad-to"><span class="avatar" style="background:var(--brand)">${ic('map-pin')}</span><div>${esc(a.dest.street)}, ${esc(a.dest.city)}<small>${a.promiseEnd?`Expected ${fmtDay(a.flags.delay&&a.stage<8?a.outAt:a.promiseEnd)} by 5pm`:'Promise set once confirmed'}</small></div></div>
        <button class="btn btn-brand" type="button" data-order="${a.id}" style="justify-self:start">Track this order${ic('arrow-right')}</button>
      </div><div class="ad-map">${netMap('o:'+a.id,'Route for '+a.id,true)}</div></section>`})():`<section class="card empty">${ic('truck','lg')}Nothing on the road right now.</section>`;
    const p=c.del?c.ontime/c.del:0;
    return `${held.map(o=>addrAlert(o)).join('')}
      <div class="co">${ad}
        <div class="side-stack">
          <section class="card ontime"><div class="donut-w">${donut(p,112,'var(--ok)')}<div class="v">${c.del?Math.round(p*100)+'%':'–'}<small>on time</small></div></div><div><h3>Delivery promise</h3><p>${c.del?`${c.ontime} of ${c.del} delivered by the promised day`:'First deliveries land today'}</p></div></section>
          <section class="card"><ul class="today">
            <li style="--c:var(--blue)"><span class="kpi-ic">${ic('package')}</span><span class="t"><span class="lbl">Open orders</span><span class="note">${m.filter(o=>o.channel==='email'&&o.stage<8).length} placed by email</span></span><span class="val">${open.length}</span></li>
            <li style="--c:var(--primary)"><span class="kpi-ic">${ic('truck')}</span><span class="t"><span class="lbl">Arriving by tomorrow</span><span class="note">current promises</span></span><span class="val">${arriving}</span></li>
            <li style="--c:var(--warn)"><span class="kpi-ic">${ic('warning')}</span><span class="t"><span class="lbl">Needs your input</span><span class="note">${held.length?'address detail missing':'nothing waiting on you'}</span></span><span class="val">${held.length}</span></li>
          </ul></section>
        </div>
      </div>
      <div class="cc2">
        <section class="card" aria-label="Recent orders"><div class="card-h">${ic('package')}Recent orders<span class="r"><a href="${viewPath('orders')}" data-go="orders">View all</a></span></div><div class="tbl-wrap">${ordersTable(recent,false)}</div></section>
        <section class="card" aria-label="Latest updates"><div class="card-h">${ic('bell')}Latest updates<span class="r"><a href="${viewPath('messages')}" data-go="messages">All</a></span></div>${updatesList(msgs,true)}</section>
      </div>
      <section class="card" aria-label="Inventory snapshot"><div class="card-h">${ic('cube')}Inventory snapshot<span class="r"><span class="legend"><span><i style="background:var(--blue)"></i>Cartons across ${WHS.length} warehouses</span><span><i style="background:var(--orange)"></i>Low somewhere</span></span><a href="${viewPath('products')}" data-go="products">Products</a></span></div>
        <div class="inv-chart">${prods.map(p=>{const t=Object.values(p.stock).reduce((s,v)=>s+v,0),lo=lowAny(p);return `<div class="inv-col" title="${esc(p.name)}"><span class="n">${t}</span><span class="inv-bar${lo?' lo':''}" style="height:${Math.max(6,t/maxT*150)}px"></span><span class="s">${p.sku}</span></div>`}).join('')}</div></section>`},
  tick(){document.querySelectorAll('[data-prog]').forEach(e=>{const o=byId(e.dataset.prog);if(o){const v=Math.round(progress(o)*100)+'%';if(e.textContent!==v)e.textContent=v}})}
};

}
