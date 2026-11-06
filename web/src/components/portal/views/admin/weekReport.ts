/* eslint-disable */
// @ts-nocheck
// The report written when a simulated week ends: what went well, what didn't, why deliveries were late and what each
// rule did, and how the live agents helped. Counts are the week's; "avoided" figures are estimates from the engine's own odds (D 30% delay vs 8%).
import { pctOf } from "@/lib/portal/utils/format";

export function createWeekReport(ctx){
const {fmtD}=ctx;
function weekReportHtml(r,open){
  const t=r.t,late=t.del-t.ontime,p=t.del?t.ontime/t.del:0,P=pctOf(t.ontime,t.del),n=x=>x.toLocaleString('en-US');
  const L=r.log||[],A=r.agents,pc=(a,b)=>b?Math.round(a/b*100):0;
  // Counts of a field over some deliveries, biggest first: [[value, count]].
  const tally=(list,f)=>{const m=new Map();for(const x of list){const k=f(x);if(k!=null)m.set(k,(m.get(k)||0)+1)}return [...m].sort((a,b)=>b[1]-a[1])};
  const lateHub=L.filter(x=>!x.onTime&&x.delayed),delayedAll=L.filter(x=>x.delayed);
  const hubs=tally(lateHub,x=>x.hub),byCarrier=tally(lateHub,x=>x.carrier),byRegion=tally(lateHub,x=>x.region);
  const top=(rows,k=2)=>rows.slice(0,k).map(([v,c])=>`${v} (${c})`).join(', ');
  const well=[],bad=[];
  if(t.del&&p>=0.71)well.push(`${P} on time, above the 71% baseline${p>=0.94?' and the 94% industry benchmark':''}.`);
  if(t.held&&!t.failed)well.push(`Every missing address was caught before picking: ${n(t.held)} held and fixed, no failed first deliveries.`);
  if(t.rescued)well.push(`${n(t.rescued)} orders that arrived after 08:00 still shipped the same day on the afternoon wave.`);
  if(t.alerts)well.push(`Clients heard about ${n(t.alerts)} delays before they had to ask.`);
  if(t.avoidedD)well.push(`${n(t.avoidedD)} orders on Carrier D’s lanes went with a more reliable carrier.`);
  if(t.topups)well.push(`Weekly allocation topped up ${n(t.topups)} low stock positions before they ran out.`);
  if(t.del&&p<0.71)bad.push(`Only ${P} on time, below the 71% baseline.`);
  else if(t.del&&p<0.94)bad.push(`${P} on time is still short of the 94% industry benchmark.`);
  if(t.lateDelay+t.lateDelayD)bad.push(`${n(t.lateDelay+t.lateDelayD)} orders arrived late after a missed hub connection${t.lateDelayD?`, ${n(t.lateDelayD)} of them on Carrier D`:''}${hubs.length?`: mostly via ${top(hubs)}, on carriers ${top(byCarrier)}, into ${top(byRegion)}`:''}. See why below.`);
  if(t.failed)bad.push(`${n(t.failed)} first deliveries failed because the address was missing a ZIP or suite.`);
  if(t.latePickup)bad.push(`${n(t.latePickup)} orders were packed after the 17:00 carrier pickup and left a day late.`);
  if(t.stockouts)bad.push(`${n(t.stockouts)} orders shipped from a farther warehouse because the nearest was out of stock, so they were promised later.`);
  if(t.chases)bad.push(`${n(t.chases)} clients emailed asking where their order was.`);
  if(!well.length)well.push('Nothing stood out this week.');if(!bad.length)bad.push('Nothing went wrong this week.');
  const carrierRate=c=>{const all=L.filter(x=>x.carrier===c),d=all.filter(x=>x.delayed).length;return {all:all.length,d,pct:pc(d,all.length)}};
  const others=L.filter(x=>x.carrier!=='D'),dOthers=others.filter(x=>x.delayed).length,dd=carrierRate('D');
  const slack=delayedAll.length-lateHub.length;
  const alertedLate=lateHub.filter(x=>x.alerted).length;
  const why={
    lateDelay:`${delayedAll.filter(x=>x.carrier!=='D').length} parcels on other carriers missed a connection (${pc(dOthers,others.length)}% of ${n(others.length)} shipped)${hubs.length?`, mostly at ${top(hubs,3)}`:''}. A missed connection pushes delivery to the next business day, past the 17:00 promise.`,
    lateDelayD:`Carrier D missed a connection on ${dd.pct}% of its ${n(dd.all)} parcels, against ${pc(dOthers,others.length)}% for the others.`,
    lateFailed:`The address was missing a ZIP or suite and went out as written, so the first delivery failed and the retry was the next business day.`,
    latePickup:`Packed after the carrier's 17:00 pickup, so the parcel left the next business day.`,
    lateOther:`Delivered after the promised 17:00 with no other recorded cause.`};
  const causes=[['Carrier delay (missed hub connection), not D',t.lateDelay,why.lateDelay],['Carrier D delay',t.lateDelayD,why.lateDelayD],['Failed first delivery, missing address',t.lateFailed,why.lateFailed],['Packed after the 17:00 carrier pickup',t.latePickup,why.latePickup],['Other',t.lateOther,why.lateOther]].filter(([,v])=>v);
  // The hub delays in detail: which carriers missed connections, where, how late and who was told.
  const carriersSeen=tally(L,x=>x.carrier).map(([c])=>c).sort();
  const eg=lateHub.slice(0,3).map(x=>`${x.id} (${x.client}, Carrier ${x.carrier} via ${x.hub} to ${x.city}, ${x.late} h past its promise)`).join('; ');
  const picked=A&&Object.entries(A.carrier.picks).filter(([,m])=>Object.keys(m).some(c=>byCarrier.some(([b])=>b===c))).map(([reg,m])=>`${Object.entries(m).sort((a,b)=>b[1]-a[1])[0][0]} for ${reg}${A.carrier.risk[reg]?` (risk rated ${A.carrier.risk[reg].toLowerCase()})`:''}`);
  const hubWhy=lateHub.length?`<div><h3 style="font-size:16px;margin:0 0 8px">Why ${n(lateHub.length)} orders were late after a missed hub connection</h3>
    <p style="margin:0 0 8px;font-size:14px">${n(delayedAll.length)} parcels missed a hub connection this week; ${n(lateHub.length)} of them arrived late${slack>0?` and ${n(slack)} still made their promise`:''}. In the simulation a parcel has about an 8% chance of missing one, 30% on Carrier D, so a busier carrier or lane shows more of them. ${alertedLate} of the ${n(lateHub.length)} clients were told before they asked${alertedLate<lateHub.length&&!r.rules.delayAlerts?' (delay alerts were off)':''}.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Carrier</th><th class="num">Parcels</th><th class="num">Missed a connection</th><th class="num">Late</th></tr></thead><tbody>${carriersSeen.map(c=>{const x=carrierRate(c);const lt=lateHub.filter(y=>y.carrier===c).length;return `<tr><td>Carrier ${c}</td><td class="num">${n(x.all)}</td><td class="num">${n(x.d)} <span class="muted">${x.pct}%</span></td><td class="num">${n(lt)}</td></tr>`}).join('')}</tbody></table></div>
    <p class="muted" style="margin:8px 0 0;font-size:13px">Hubs: ${top(hubs,6)}. Regions: ${top(byRegion,4)}. For example ${eg}.${picked&&picked.length?` The carrier agent had chosen ${picked.join(', ')} for these lanes; the odds above are the simulation's own, not the agent's estimate.`:''}</p></div>`:'';
  const on=k=>r.rules[k]?'<span class="chip ok">On</span>':'<span class="chip bad">Off</span>';
  const helped=[
    ['Address check','addressCheck',r.rules.addressCheck?`Held ${n(t.held)} orders with a missing ZIP or suite until the client or operations filled it in. Each would otherwise have failed its first delivery and arrived a day late.`:`${n(t.failed)} first deliveries failed for a missing address; ${n(t.lateFailed)} of them ended up late.`],
    ['Afternoon wave','afternoonWave',r.rules.afternoonWave?`${n(t.rescued)} orders that came in after the 08:00 pick list still shipped the same day instead of the next morning.`:'Orders after 08:00 waited for the next morning wave, a day later.'],
    ['Avoid Carrier D','avoidD',r.rules.avoidD?`${n(t.avoidedD)} orders moved off D. D misses a hub connection about 30% of the time against 8% for the others, so roughly ${n(Math.round(t.avoidedD*0.22))} delays were avoided.`:`D carried its lanes: ${n(t.delaysD)} delays on D, ${n(t.lateDelayD)} late deliveries.`],
    ['Delay alerts','delayAlerts',r.rules.delayAlerts?`${n(t.alerts)} clients were told about a delay before they asked; ${n(t.chases)} still chased.`:`${n(t.delays)} delays went unannounced and ${n(t.chases)} clients chased.`],
    ['Weekly allocation','weeklyAllocation',r.rules.weeklyAllocation?`${n(t.topups)} low stock positions topped up from the other warehouses; ${n(t.stockouts)} orders still had to ship from farther away.`:`No top-ups: ${n(t.stockouts)} orders shipped from a farther warehouse.`],
  ];
  const none=x=>`<span class="muted">${x}</span>`;
  const picks=A&&Object.entries(A.carrier.picks).map(([reg,m])=>`${reg} → ${Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([c,k])=>`${c} (${k})`).join(', ')}`).join('; ');
  const cStat=c=>{const x=L.filter(y=>y.carrier===c);return x.length?`${c} ${pc(x.filter(y=>y.onTime).length,x.length)}%`:null};
  const agentRows=A?[
    ['Email agent',A.email.read?`Read ${n(A.email.read)} order emails and found ${n(A.email.lines)} product lines. ${n(A.email.flagged)} had a missing delivery field, so the client was asked before picking.`:none('No emails read.'),A.failed['Email agent']||A.skipped['Email agent']?`${A.failed['Email agent']} failed, ${A.skipped['Email agent']} skipped while busy.`:''],
    ['Carrier agent',A.carrier.plans?`Planned ${n(A.carrier.orders)} same-day orders in ${n(A.carrier.plans)} cutoff plan${A.carrier.plans===1?'':'s'}; ${n(A.carrier.cleared)} cleared for dispatch, ${n(A.carrier.review)} sent for review${A.carrier.rejected?`, ${A.carrier.rejected} plan${A.carrier.rejected===1?'':'s'} refused by the validator`:''}. Carriers chosen: ${picks||'none'}.`:none('No plan this week.'),(carriersSeen.map(cStat).filter(Boolean).join(', ')?`On time by carrier: ${carriersSeen.map(cStat).filter(Boolean).join(', ')}. `:'')+(A.failed['Carrier agent']||A.skipped['Carrier agent']?`${A.failed['Carrier agent']} failed, ${A.skipped['Carrier agent']} skipped.`:'')],
    ['Allocation agent',A.allocation.runs?`${r.agentRun?`Twice-weekly rebalance (simulation only) ran ${n(A.allocation.runs)} time${A.allocation.runs===1?'':'s'},`:'Weekly rebalance (simulation only)'} reviewed ${n(A.allocation.products)} products and suggested ${n(A.allocation.suggested)} cartons of transfers, ${n(A.allocation.moved)} moved. ${A.allocation.unchanged} needed no move.${A.allocation.notes.length?` e.g. ${A.allocation.notes.slice(0,2).join('; ')}.`:''}`:none('No rebalance this week.'),A.failed['Allocation agent']||A.skipped['Allocation agent']?`${A.failed['Allocation agent']} failed, ${A.skipped['Allocation agent']} skipped.`:''],
    ['Stock-out handling',A.stockouts.rerouted?`Rerouted ${n(A.stockouts.rerouted)} orders to the next warehouse with stock and ${r.agentRun?'logged each product for the next rebalance':'handed each product to the allocation agent'}${A.stockouts.products.length?` (${A.stockouts.products.slice(0,3).join(', ')})`:''}.`:none('No stock-outs.'),'']
  ]:null;
  const agentsHtml=agentRows?`<div><h3 style="font-size:16px;margin:0 0 8px">How the agents helped</h3>${r.agentRun?'<p class="muted" style="margin:0 0 8px;font-size:13px">Agent run: the clock waited for every agent call, so nothing was skipped.</p>':''}${agentRows.every(x=>x[1].startsWith('<span'))?'<p class="muted" style="margin:0">The live agents made no calls this week (switched off, or no matching events).</p>':`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Agent</th><th>What it did</th><th>Result</th></tr></thead><tbody>${agentRows.map(([a,x,y])=>`<tr><td><b>${a}</b></td><td class="wrap">${x}</td><td class="wrap">${y}</td></tr>`).join('')}</tbody></table></div>`}</div>`:'';
  const body=`<div style="display:grid;gap:16px;padding-top:12px">
    <div class="stats3">
      <div class="card stat" style="--c:var(--blue)"><div><b>${n(t.rcv)}</b><span>Orders received</span></div></div>
      <div class="card stat" style="--c:var(--ok)"><div><b>${P}</b><span>On time · ${n(t.ontime)} of ${n(t.del)} delivered</span></div></div>
      <div class="card stat" style="--c:var(--bad)"><div><b>${n(late)}</b><span>Late · ${pctOf(late,t.del)} of deliveries</span></div></div>
    </div>
    <div class="cc2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))">
      <div><h3 style="font-size:16px;margin:0 0 8px">What went well</h3><ul style="margin:0;padding-left:20px;display:grid;gap:6px;font-size:14px">${well.map(x=>`<li>${x}</li>`).join('')}</ul></div>
      <div><h3 style="font-size:16px;margin:0 0 8px">What didn’t</h3><ul style="margin:0;padding-left:20px;display:grid;gap:6px;font-size:14px">${bad.map(x=>`<li>${x}</li>`).join('')}</ul></div>
    </div>
    <div><h3 style="font-size:16px;margin:0 0 8px">Why deliveries were late</h3>${causes.length?`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cause</th><th class="num">Orders</th><th class="num">Share of late</th><th>Why it happened</th></tr></thead><tbody>${causes.map(([c,v,w])=>`<tr><td>${c}</td><td class="num">${n(v)}</td><td class="num">${pctOf(v,late)}</td><td class="wrap">${w}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted" style="margin:0">No late deliveries.</p>'}</div>
    ${hubWhy}
    ${agentsHtml}
    <div><h3 style="font-size:16px;margin:0 0 8px">How the rules helped</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Rule</th><th>At week’s end</th><th>What it did</th></tr></thead><tbody>${helped.map(([l,k,x])=>`<tr><td><b>${l}</b></td><td>${on(k)}</td><td class="wrap">${x}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;
  return `<details class="card" style="padding:16px 20px"${open?' open':''}><summary style="cursor:pointer;font-weight:600">Week ${r.week} report · ${fmtD(r.from*1440)} to ${fmtD(r.to*1440)} · ${P} on time${r.agentRun?' · agent run':''}</summary>${body}</details>`;
}
return weekReportHtml;
}
