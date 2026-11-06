/* eslint-disable */
// @ts-nocheck
// Clients and their live order activity.
import { ic } from "@/components/portal/icons";
import { esc } from "@/lib/portal/utils/dom";
import { pct } from "@/lib/portal/utils/format";

export function createAdminClients(ctx){
const {CLIENTS,VIA,cs,orders}=ctx;
return {
  shell(){return `<div class="page-h"><div><h1>Clients</h1><p>12 of 280 enterprise clients, shown with live order activity.</p></div></div><section class="card"><div class="tbl-wrap" data-region></div></section>`},
  sig(){return orders.map(o=>o.stage+(o.held?1:0)).join('')},
  region(){return `<table class="tbl"><thead><tr><th>Client</th><th>Orders by</th><th class="num">Open</th><th class="num">Needs address</th><th class="num">Delivered</th><th class="num">On time</th><th></th></tr></thead><tbody>
    ${CLIENTS.map((c,i)=>{const m=orders.filter(o=>o.ci===i),k=cs(i);return `<tr><td><span class="status"><span class="avatar" style="background:${c.color};width:24px;height:24px">${c.name[0]}</span>${esc(c.name)}</span><span class="sub">${esc(c.contact)} · ${c.domain}</span></td><td><span class="chip ch">${VIA[c.ch]}</span></td><td class="num">${m.filter(o=>o.stage<8).length}</td><td class="num">${m.filter(o=>o.held).length||'–'}</td><td class="num">${k.del}</td><td class="num">${pct(k.ontime,k.del)}</td><td><button class="btn btn-quiet btn-sm" type="button" data-clientorders="${esc(c.name)}">View orders${ic('caret-right')}</button></td></tr>`}).join('')}</tbody></table>`}
};

}
