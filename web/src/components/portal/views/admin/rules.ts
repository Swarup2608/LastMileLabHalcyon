/* eslint-disable */
// @ts-nocheck
// Rules: the five fixes from the discovery log, each switchable.
export const RULES=[
 ['addressCheck','Address check before picking','map-pin','Hold orders with an incomplete address and ask the client automatically, instead of shipping and failing at the door.','Worth 7.3 points of on time (discovery Q-001)'],
 ['afternoonWave','Afternoon pick wave','lightning','Orders that land between 08:00 and 13:00 join a 14:00 wave instead of waiting for tomorrow.','Worth 5.8 points (Q-002)'],
 ['weeklyAllocation','Weekly allocation review','warehouse','Top up each warehouse nightly from demand. Off means allocation stays as set at onboarding, reviewed quarterly.','Worth 5.3 points (Q-003)'],
 ['avoidD','Avoid Carrier D on Midwest and Southeast','truck','Use Carrier B and E on these lanes instead of the spreadsheet default. Carrier D runs about 30% delays here in this demo.','Worth 3.4 of 6.4 carrier points (Q-004)'],
 ['delayAlerts','Proactive delay alerts','bell-ringing','Tell the client the moment a parcel misses a connection, with a new estimate. Off means clients find out by chasing.','Covers 12 of 34 complaints (Q-005)'],
];

import { ic } from "@/components/portal/icons";

export function createAdminRules(ctx){
const {rules}=ctx;
return {
  shell(){return `<div class="page-h"><div><h1>Rules</h1><p>Each rule is one fix from the discovery log. Turn one off to see what happens to the live numbers.</p></div><div class="acts"><button class="btn btn-secondary" type="button" data-allrules="off">Turn all off</button><button class="btn btn-brand" type="button" data-allrules="on">Turn all on</button></div></div><div class="rules" data-region></div>`},
  sig(){return JSON.stringify(rules)},
  region(){return RULES.map(([k,t,i,d,imp])=>`<article class="card rule"><div class="rule-top"><span class="kpi-ic" style="--c:var(${rules[k]?'--ok':'--bad'});width:32px;height:32px">${ic(i)}</span><div><h3>${t}</h3><span class="rule-state ${rules[k]?'on':'off'}">${rules[k]?'On':'Off'}</span></div>
    <button class="switch" type="button" role="switch" aria-checked="${rules[k]}" aria-label="${t}" data-rule="${k}" data-key="rule-${k}"></button></div><p>${d}</p><div class="impact"><span class="chip blue">${imp}</span></div></article>`).join('')}
};

}
