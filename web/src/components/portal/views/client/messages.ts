/* eslint-disable */
// @ts-nocheck
// The client's Messages: every update about their orders, by day.
import { ic } from "@/components/portal/icons";
import { viewPath } from "@/lib/portal/types";
import { esc } from "@/lib/portal/utils/dom";

export function createClientMessages(ctx){
const {BASE,S,VIA,addrAlert,dayOf,fmtDay,fmtT,myOrders,updateView}=ctx;
return {
  shell(){return `<div class="page-h"><div><p class="kick">Inbox</p><h1>Messages</h1><p>Everything we’ve told you about your orders, newest first.</p></div></div><div class="bar-row" data-mtabs></div><div data-region style="display:grid;gap:16px"></div>`},
  mount(main){main.querySelector('[data-mtabs]').addEventListener('click',e=>{const b=e.target.closest('[data-mf]');if(b){S.f.mf=b.dataset.mf;updateView(true)}})},
  MF:{all:m=>true,attn:m=>m.kind==='warn',delay:m=>m.kind==='bad',done:m=>/Delivered/.test(m.text)},
  sig(){return myOrders().reduce((a,o)=>a+o.msgs.length,0)+'|'+myOrders().filter(o=>o.held).length+JSON.stringify(ctx.emailed)+(S.f.mf||'')},
  region(){
    // Emailed orders' messages, as minutes from day 0 like the simulated ones, so both sort and group by day together.
    const mail=ctx.emailed.flatMap(r=>r.messages.map(x=>({t:(new Date(x.at)-BASE)/60000,text:x.text,kind:x.kind,o:{id:r.id,channel:'email',product:{name:r.items||'Emailed order'}}})));
    const m=myOrders(),cur=S.f.mf||'all',all=[...m.flatMap(o=>o.msgs.map(x=>({...x,o}))),...mail].sort((a,b)=>b.t-a.t);
    const tabs=document.querySelector('[data-mtabs]');
    if(tabs)tabs.innerHTML=`<div class="ptabs" role="group" aria-label="Filter messages">${[['all','All'],['attn','Action needed'],['delay','Delays'],['done','Deliveries']].map(([k,l])=>`<button type="button" data-mf="${k}" data-key="mf-${k}" aria-pressed="${cur===k}">${l}<span class="n">${all.filter(this.MF[k]).length}</span></button>`).join('')}</div>`;
    const held=m.filter(o=>o.held);
    const list=all.filter(this.MF[cur]).slice(0,80);
    const groups=[];list.forEach(x=>{const d=dayOf(x.t);let g=groups.find(g=>g.d===d);if(!g)groups.push(g={d,items:[]});g.items.push(x)});
    const icon=k=>k==='bad'?['bell-ringing','--bad']:k==='warn'?['warning','--warn']:k==='ok'?['check-circle','--ok']:['envelope-simple','--blue'];
    return `${(cur==='all'||cur==='attn')?held.map(o=>addrAlert(o)).join(''):''}
      ${groups.length?groups.map(g=>`<div class="daygrp"><h3>${dayOf(ctx.simNow)===g.d?'Today':dayOf(ctx.simNow)-1===g.d?'Yesterday':fmtDay(g.d*1440)}</h3><section class="card"><ul class="mlist">${g.items.map(x=>{const[i,c]=icon(x.kind);return `<li style="--c:var(${c})"><span class="ai">${ic(i,'lg')}</span><span class="tx">${esc(x.text)}<small><a class="mono" href="${viewPath('order',x.o.id)}" data-order="${esc(x.o.id)}">${esc(x.o.id)}</a> · ${esc(x.o.product.name)} · ${VIA[x.o.channel]}</small></span><span class="tm">${fmtT(x.t)}</span></li>`}).join('')}</ul></section></div>`).join(''):`<div class="card empty">${ic('bell','lg')}No messages here.</div>`}`}
};

}
