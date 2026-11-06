/* eslint-disable */
// @ts-nocheck
// The Whole simulation card on the Simulation page: every rate since the demo clock started, then this week day by day
// with its total (and the whole run's, from week 2).
import { ic } from "@/components/portal/icons";
import { pctOf } from "@/lib/portal/utils/format";
import { CARRIERS } from "@/lib/portal/world";

export function createSimulationTable(ctx){
const {RUN_START,WEEK_DAYS,carrierStats,dayOf,fmtD,runTotals,st,totals,weekFrom}=ctx;
return function simulationTableHtml(){
  const run=runTotals();
  const wf=weekFrom(ctx.weekNo),days=[];for(let dd=wf;dd<=Math.min(dayOf(ctx.simNow),wf+WEEK_DAYS-1);dd++)days.push([dd,st(dd)]);const wk=totals(wf,wf+WEEK_DAYS-1);
  const cell=(n,of)=>`${n.toLocaleString('en-US')} <span class="muted">${pctOf(n,of)}</span>`;
  const dayRow=(label,x,cls)=>`<tr${cls?` class="${cls}"`:''}><td>${label}</td><td class="num">${x.rcv.toLocaleString('en-US')}</td><td class="num">${cell(x.email,x.rcv)}</td><td class="num">${cell(x.held,x.rcv)}</td><td class="num">${cell(x.rescued,x.rcv)}</td><td class="num">${cell(x.stockouts,x.rcv)}</td><td class="num">${x.del.toLocaleString('en-US')}</td><td class="num"><b>${pctOf(x.ontime,x.del)}</b></td><td class="num">${cell(x.del-x.ontime,x.del)}</td><td class="num">${cell(x.failed,x.del)}</td><td class="num">${x.alerts}</td><td class="num">${x.chases}</td></tr>`;
  const kpi=(label,val,note,c)=>`<div class="card stat" style="--c:var(${c})"><div><b>${val}</b><span>${label}${note?` · ${note}`:''}</span></div></div>`;
  const carriersRun=CARRIERS.filter(c=>carrierStats[c].del).map(c=>`<span class="chip ${carrierStats[c].ontime/carrierStats[c].del>=0.9?'ok':carrierStats[c].ontime/carrierStats[c].del<0.75?'bad':''}">${c} ${pctOf(carrierStats[c].ontime,carrierStats[c].del)}</span>`).join(' ');
  const rh=`<div class="card-h">${ic('flag-checkered')}Whole simulation<span class="r muted" style="font-size:12px;line-height:16px">Week ${ctx.weekNo}, day ${Math.min(WEEK_DAYS,dayOf(ctx.simNow)-wf+1)} of ${WEEK_DAYS} · stops at the end of the week · started ${fmtD(RUN_START*1440)}</span></div>
    <div style="padding:16px;display:grid;gap:16px">
      <div class="stats3">
        ${kpi('On time',pctOf(run.ontime,run.del),`${run.ontime.toLocaleString('en-US')} of ${run.del.toLocaleString('en-US')} delivered`,'--ok')}
        ${kpi('Late',pctOf(run.del-run.ontime,run.del),`${(run.del-run.ontime).toLocaleString('en-US')} orders`,'--bad')}
        ${kpi('Held at address check',pctOf(run.held,run.rcv),`${run.held} of ${run.rcv.toLocaleString('en-US')} received`,'--warn')}
        ${kpi('Saved by afternoon wave',pctOf(run.rescued,run.rcv),`${run.rescued} after 08:00`,'--primary')}
        ${kpi('Shipped from another warehouse',pctOf(run.stockouts,run.rcv),`${run.stockouts} stock-outs`,'--orange')}
        ${kpi('Failed first delivery',pctOf(run.failed,run.del),`${run.failed} back to depot`,'--s4')}
      </div>
      ${carriersRun?`<p class="muted" style="font-size:13px;margin:0">On time by carrier, whole simulation: ${carriersRun}</p>`:''}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Day</th><th class="num">Received</th><th class="num">By email</th><th class="num">Held</th><th class="num">Afternoon wave</th><th class="num">Stock-outs</th><th class="num">Delivered</th><th class="num">On time</th><th class="num">Late</th><th class="num">Failed</th><th class="num">Delay alerts</th><th class="num">Chasing</th></tr></thead>
        <tbody>${days.map(([dd,x])=>dayRow(fmtD(dd*1440)+(dd===dayOf(ctx.simNow)?' (today)':''),x)).join('')}${dayRow(`<b>Week ${ctx.weekNo} so far</b>`,wk,'tot')}${ctx.weekNo>1?dayRow('<b>Whole run</b>',run,'tot'):''}</tbody></table></div>
      <p class="muted" style="font-size:12px;margin:0">Held, afternoon wave and stock-outs are shares of orders received; late and failed are shares of orders delivered. Orders count on the day they arrive, deliveries on the day they land.</p>
    </div>`;
  return rh;
};
}
