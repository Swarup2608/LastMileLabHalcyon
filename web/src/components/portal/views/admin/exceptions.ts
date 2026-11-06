/* eslint-disable */
// @ts-nocheck
// Exceptions: delays, incomplete addresses and farther warehouses (under the React cards).
import { ic } from "@/components/portal/icons";
import { esc } from "@/lib/portal/utils/dom";

export function createAdminExceptions(ctx){
const {fmtD,orders,paged,pgSig,statusChip,whCity}=ctx;
return {
  // The page header, the address check queue and the ctx.emailed orders above this are React
  // (components/console/ExceptionsView.tsx).
  // minmax(0,1fr): a wide table scrolls inside its card instead of widening the page.
  shell(){return `<div data-region style="display:grid;grid-template-columns:minmax(0,1fr);gap:24px"></div>`},
  sig(){return orders.filter(o=>o.held||(o.flags.delay&&o.stage<8)||(o.flags.badAddr&&o.stage<8)||o.flags.transfer&&o.stage<6).map(o=>o.id+o.stage+o.held+(o.flags.alerted?1:0)).join()+pgSig()},
  region(){
    const delays=orders.filter(o=>o.flags.delay&&o.stage<8);
    const bad=orders.filter(o=>o.flags.badAddr&&o.stage<8);
    const xfer=orders.filter(o=>o.flags.transfer&&o.stage>=3&&o.stage<6);
    // Empty: one muted line under the card's header, as in the React cards above.
    const tbl=(key,list,cols)=>{if(!list.length)return `<p class="muted" style="display:flex;align-items:center;gap:8px;margin:0;padding:0 20px 16px;font-size:14px;line-height:20px">${ic('check-circle')}Nothing here right now.</p>`;const {rows,pager}=paged(key,list,'orders');
      return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map(c=>`<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map(o=>`<tr data-order="${o.id}" tabindex="0" data-key="ex-${o.id}">${cols.map(c=>`<td>${c[1](o)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${pager}`};
    // Held orders (the address check queue) are in the React Address issues card, with every channel's; addressHolds().
    return `<section class="card"><div class="card-h">${ic('bell-ringing')}Delays in transit<span class="r"><span class="chip bad">${delays.length}</span></span></div>
      ${tbl('xdelays',delays,[['Order',o=>`<span class="id">${o.id}</span>`],['Client',o=>esc(o.client.name)],['Carrier',o=>'Carrier '+o.carrier],['Where',o=>esc(o.hub)],['New estimate',o=>fmtD(o.outAt)],['Client told',o=>o.flags.alerted?`<span class="chip ok">${ic('check')}Alert sent</span>`:`<button class="btn btn-secondary btn-sm" type="button" data-notify="${o.id}">${ic('paper-plane-tilt')}Send alert</button>`]])}</section>
      ${bad.length?`<section class="card"><div class="card-h">${ic('warning')}Shipped with incomplete addresses<span class="r"><span class="chip bad">${bad.length}</span></span></div>${tbl('xbad',bad,[['Order',o=>`<span class="id">${o.id}</span>`],['Client',o=>esc(o.client.name)],['Missing',o=>o.missing],['Status',o=>statusChip(o)]])}</section>`:''}
      <section class="card"><div class="card-h">${ic('warehouse')}Shipping from a farther warehouse<span class="r"><span class="chip">${xfer.length}</span></span></div>
      ${tbl('xfer',xfer,[['Order',o=>`<span class="id">${o.id}</span>`],['Product',o=>esc(o.product.sku)],['Out of stock in',o=>esc(whCity(o.flags.transfer))],['Ships from',o=>esc(whCity(o.wh))],['Status',o=>statusChip(o)]])}</section>`}
};

}
