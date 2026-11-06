/* eslint-disable */
// @ts-nocheck
// Carriers: performance in the demo and lane rules.
import { ic } from "@/components/portal/icons";
import { esc } from "@/lib/portal/utils/dom";
import { pct } from "@/lib/portal/utils/format";
import { CARRIERS, ENGINE, SHEET } from "@/lib/portal/world";

export function createAdminCarriers(ctx){
const {WH_OF,carrierStats,orders,rules,whName}=ctx;
return {
  shell(){return `<div class="page-h"><div><h1>Carriers</h1><p>Six carriers, chosen per lane. The old preference spreadsheet put Carrier D on Midwest and Southeast.</p></div></div>
    <div data-region style="display:grid;gap:24px"></div>`},
  sig(){return JSON.stringify(carrierStats)+rules.avoidD+orders.filter(o=>o.stage===6).length},
  region(){
    const lanes=Object.keys(SHEET);
    return `<section class="card"><div class="card-h">${ic('truck')}Performance in this demo</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Carrier</th><th>Lanes in use</th><th class="num">In transit</th><th class="num">Delivered</th><th class="num">On time</th><th class="num">Delays</th></tr></thead><tbody>
      ${CARRIERS.map(c=>{const k=carrierStats[c],use=lanes.filter(l=>(rules.avoidD?ENGINE:SHEET)[l]===c);return `<tr><td><strong>Carrier ${c}</strong>${c==='D'?` <span class="chip ${rules.avoidD?'ok':'warn'}">${rules.avoidD?'Avoided':'In use'} on Midwest, Southeast</span>`:''}</td><td>${use.length?use.join(', '):'<span class="muted">None</span>'}</td><td class="num">${orders.filter(o=>o.carrier===c&&o.stage>=6&&o.stage<8).length}</td><td class="num">${k.del}</td><td class="num">${pct(k.ontime,k.del)}</td><td class="num">${k.delays}</td></tr>`}).join('')}</tbody></table></div></section>
      <section class="card"><div class="card-h">${ic('map-trifold')}Lane rules${ctx.S.user.canEditRules?`<span class="r"><button class="btn btn-secondary btn-sm" type="button" data-go="rules">${ic('sliders-horizontal')}Change in Rules</button></span>`:''}</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lane</th><th>Ships from</th><th>Spreadsheet says</th><th>Halcyon uses</th></tr></thead><tbody>
      ${lanes.map(l=>`<tr><td>${l}</td><td>${esc(whName(WH_OF[l]))}</td><td>Carrier ${SHEET[l]}</td><td>Carrier ${(rules.avoidD?ENGINE:SHEET)[l]}${SHEET[l]!==(rules.avoidD?ENGINE:SHEET)[l]?' <span class="chip ok">changed</span>':''}</td></tr>`).join('')}</tbody></table></div></section>`}
};

}
