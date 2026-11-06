/* eslint-disable */
// @ts-nocheck
/*
 * Halcyon portal engine: the live order simulation, ported from the "Halcyon 2.html" prototype. startPortal() runs
 * it for the signed-in user (the /portal layout, <ConsoleShell/>, starts it and tears it down with dispose()). The
 * HTML views it drives live in components/portal; helpers in ./utils and ./world. Each page hands the engine its
 * body element with show(); the layout reads the header badges and demo clock from status().
 * Signing in and out belongs to the API; the engine only renders for the user it is given.
 */
import { createComposer } from "@/components/portal/composer";
import { createEvents } from "@/components/portal/events";
import { createMap } from "@/components/portal/map";
import { createPager } from "@/components/portal/pager";
import { createParts } from "@/components/portal/parts";
import { createRouter } from "@/components/portal/router";
import { createViewState } from "@/components/portal/viewState";
import { createViews } from "@/components/portal/views";
import type { PortalEngine, PortalNetwork, PortalUser } from "./types";
import { createCalendar } from "./utils/calendar";
import { toast } from "./utils/dom";
import { pctOf } from "./utils/format";
import { createLiveAgents } from "./liveAgents";
import { createRandom } from "./utils/random";
import { CARRIERS, DEST, ENGINE, HUBS, SHEET, createWorld } from "./world";

export * from "./types";

// The current date and time in `timeZone` as a local Date with the same fields, and the zone's short name ("EDT").
function wallClock(timeZone){
  const now=new Date();
  try{
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',hourCycle:'h23',timeZoneName:'short'}).formatToParts(now).map(p=>[p.type,p.value]));
    return {STARTED:new Date(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute),ZONE:parts.timeZoneName||''};
  }catch{return {STARTED:now,ZONE:''}}
}

// navigate: moves to another portal page (the Next.js router), for the engine's own links and buttons.
export function startPortal(user: PortalUser, network: PortalNetwork, navigate: (path: string) => void): PortalEngine {
const listeners=[];let timer=0;
const listen=(type,fn)=>{document.addEventListener(type,fn);listeners.push([type,fn])};
const dispose=()=>{clearInterval(timer);live&&live.dispose();for(const [t,f] of listeners)document.removeEventListener(t,f);subs.clear()};
// Day 0 of the simulation is today, so the demo clock starts at the current date and time in the cutoff's zone
// (network.timeZone, else the browser's). The calendar reads a Date's local fields, so STARTED holds that zone's wall clock.
const {STARTED,ZONE}=wallClock(network.timeZone);
const {BASE,dayOf,isWeekend,nextBiz,fmtT,fmtD,fmtDT,fmtDay}=createCalendar(STARTED);
const {rnd,ri,pick}=createRandom();
const {WHS,WH_OF,whName,whCity,CLIENTS,PRODUCTS,SELLERS,myClient,carries,lowAt,lowAny}=createWorld(network,user);
const S=createViewState();

/* ===================== simulation ===================== */
const rules={addressCheck:true,afternoonWave:true,weeklyAllocation:true,avoidD:true,delayAlerts:true};
// The live agents (staff only; liveAgents.ts) and the carrier each region was last given by the carrier agent.
let live=null,lastCutoffDay=-1;const liveCarrier={};
let simNow=0,speed=1,paused=true,nextId=48190,nextArrival=0;
const orders=[],events=[];let evSeq=0;
// Per-day counters. late*: why a late delivery was late (carrier delay, on D or another carrier; a failed first attempt
// for a missing address; packed after the carrier's 17:00 pickup; anything else). avoidedD and topups: what the Avoid D
// and Weekly allocation rules did.
const STAT_KEYS=['rcv','email','held','rescued','alerts','del','ontime','chases','failed','stockouts','lateDelay','lateDelayD','lateFailed','latePickup','lateOther','avoidedD','topups','delays','delaysD'];
const stats={};const st=d=>stats[d]||(stats[d]=Object.fromEntries(STAT_KEYS.map(k=>[k,0])));
const cstats={};const cs=(c)=>cstats[c]||(cstats[c]={del:0,ontime:0});
// Every delivery, for the week report's reasons: who, which carrier and hub, and why it was late.
const dlog=[];
const carrierStats={};for(const c of CARRIERS)carrierStats[c]={del:0,ontime:0,delays:0};
function addH(o,t,text,kind){o.hist.push({t,text,kind:kind||'',stage:o.stage});o.lastT=t;events.unshift({seq:++evSeq,t,id:o.id,text,kind:kind||''});if(events.length>120)events.length=120}
function msg(o,t,text,kind){o.msgs.push({t,text,kind:kind||''})}

function emailBody(o){
  const d=o.dest,first=o.client.contact.split(' ')[0];
  return `Hi Halcyon team,\n\nPlease ship ${o.qty} cartons of ${o.product.sku} ${o.product.name} (PO ${o.po}) to:\n${d.street}\n${o.missing==='suite number'?'':d.unit+'\n'}${d.city}, ${d.st}${o.missing==='ZIP code'?'':' '+d.zip}\n\nThanks,\n${first}\n${o.client.name}`;
}
function newOrder(t,opt={}){
  const ci=opt.ci??pick(SELLERS),c=CLIENTS[ci],plist=PRODUCTS.filter(p=>p.client===ci);
  if(!c||!(opt.product||plist.length))return null;
  const ch=opt.channel||c.ch, dest=opt.dest||pick(DEST);
  const o={id:'HLX-'+(nextId++),ci,client:c,channel:ch,dest,product:opt.product||pick(plist),qty:opt.qty||ri(2,18),po:opt.po||String(ri(41000,58999)),arrival:t,
    stage:0,nextAt:t,hist:[],msgs:[],lastT:t,flags:{},held:false,missing:null,user:!!opt.user};
  if(opt.missing!==undefined)o.missing=opt.missing;
  else{const p=ch==='email'?0.28:0.05;if(rnd()<p)o.missing=rnd()<0.7?'ZIP code':'suite number'}
  o.subject=opt.subject||`PO ${o.po} · ${o.qty} cartons`;
  o.body=opt.body||(ch==='email'?emailBody(o):null);
  orders.push(o);const s=st(dayOf(t));s.rcv++;if(ch==='email')s.email++;
  if(ch==='email'&&live)live.onEmail({from:`${c.contact} <${c.contact.split(' ')[0].toLowerCase()}@${c.domain}>`,subject:o.subject,body:o.body});
  const via={email:'Email',edi:'EDI',api:'API',portal:'Portal'}[ch];
  addH(o,t,ch==='email'?`Email received from ${c.contact}`:ch==='portal'?`Placed in the portal by ${c.contact}`:`${via} order received`);
  msg(o,t,ch==='email'?`We received your email order at ${fmtT(t)}.`:ch==='portal'?`Order placed in the portal at ${fmtT(t)}.`:`We received your order through ${via}.`);
  return o;
}
function allocate(o){
  const home=WH_OF[o.dest.region],p=o.product;
  const dm=(w)=>p.demand[w]||(p.demand[w]={routed:0,missed:0,sentForOthers:0});
  if(p.stock[home]>=o.qty){p.stock[home]-=o.qty;o.wh=home;o.transit=1;dm(home).routed+=o.qty;return}
  const alt=WHS.map(w=>w.id).filter(w=>w!==home).sort((a,b)=>p.stock[b]-p.stock[a])[0];
  p.stock[alt]=Math.max(0,p.stock[alt]-o.qty);o.wh=alt;o.transit=2;dm(home).missed+=o.qty;dm(alt).routed+=o.qty;dm(alt).sentForOthers+=o.qty;o.flags.transfer=home;st(dayOf(simNow)).stockouts++;
  if(live)live.onStockout({productId:p.id,productName:p.name,orderId:o.id,qty:o.qty,nearest:home,shippedFrom:alt,day:dayOf(simNow)});
}
function plan(o,t){
  let d=dayOf(t),m=t-d*1440,wave,waveName;
  if(isWeekend(d)){d=nextBiz(d);wave=d*1440+540;waveName='morning wave'}
  else if(m<480){wave=d*1440+540;waveName='morning wave'}
  else if(m<780&&rules.afternoonWave){wave=d*1440+840;waveName='afternoon wave';o.flags.rescued=true;st(dayOf(t)).rescued++}
  else{d=nextBiz(d+1);wave=d*1440+540;waveName='next morning wave'}
  o.waveAt=wave;o.waveName=waveName;allocate(o);
  const lane=SHEET[o.dest.region];
  o.carrier=(rules.avoidD?liveCarrier[o.dest.region]||ENGINE[o.dest.region]:SHEET[o.dest.region]);if(lane==='D'&&rules.avoidD){o.flags.avoidedD=true;st(dayOf(t)).avoidedD++}
  o.promiseEnd=nextBiz(dayOf(wave)+o.transit)*1440+1020;
  addH(o,t,`Promised ${fmtD(o.promiseEnd)} by 17:00. Joins the ${waveName} at ${fmtT(wave)}${o.flags.transfer?`. Ships from ${whName(o.wh)}, out of stock in ${whCity(o.flags.transfer)}`:''}`,o.flags.rescued?'pri':(o.flags.transfer?'warn':''));
  msg(o,t,`Order confirmed. Arriving ${fmtDay(o.promiseEnd)} by 5pm.`,'ok');
}
function advance(o){
  const t=o.nextAt;
  switch(o.stage){
    case 0:o.stage=1;addH(o,t+1,o.channel==='email'?'Email read and order fields extracted automatically':'Loaded into the WMS');o.nextAt=t+1;break;
    case 1:
      o.stage=2;
      if(!o.missing){addH(o,t,'Address verified against the postal file','ok');o.nextAt=t}
      else if(!rules.addressCheck){o.flags.badAddr=true;addH(o,t,`Address check off: ${o.missing} missing, shipped as written`,'warn');o.nextAt=t}
      else{o.held=true;st(dayOf(t)).held++;addH(o,t,`Held at address check: ${o.missing} missing. Client asked automatically`,'warn');
        // Simulated clients answer within the hour; the viewer's own orders wait for them, at most 5 hours.
        msg(o,t,`We need the ${o.missing} for ${o.dest.street}, ${o.dest.city} before we can ship.`,'warn');o.nextAt=t+(o.user?300:ri(10,60))}
      break;
    case 2:
      if(o.held){o.held=false;addH(o,t,o.fixedBy==='ops'?`Address completed by operations with the validated ${o.missing}`:`${o.client.contact.split(' ')[0]} added the ${o.missing}`,'ok');msg(o,t,'Thanks, address updated.','ok');o.missing=o.flags.badAddr?o.missing:null}
      o.stage=3;plan(o,t);o.nextAt=o.waveAt;break;
    case 3:o.stage=4;addH(o,t,`Picking started at ${whName(o.wh)}`);o.nextAt=t+ri(40,110);break;
    case 4:{o.stage=5;const d=dayOf(t);o.collectAt=(t-d*1440<=1005)?d*1440+1020:nextBiz(d+1)*1440+1020;if(t-d*1440>1005)o.flags.missedPickup=true;
      addH(o,t,`Packed and booked on Carrier ${o.carrier}${o.flags.avoidedD?' (spreadsheet said D, avoided on this lane)':''}`);msg(o,t,`Packed and ready for Carrier ${o.carrier}.`);o.nextAt=o.collectAt;break}
    case 5:{o.stage=6;addH(o,t,`Collected by Carrier ${o.carrier}`);msg(o,t,`On its way with Carrier ${o.carrier}.`);
      o.outAt=nextBiz(dayOf(t)+o.transit)*1440+480+ri(0,90);
      const p=o.carrier==='D'?0.3:0.08;
      if(rnd()<p){o.delayPending=true;o.nextAt=t+ri(180,560)}else o.nextAt=o.outAt;break}
    case 6:
      if(o.delayPending){o.delayPending=false;o.flags.delay=true;o.hub=pick(HUBS);carrierStats[o.carrier].delays++;{const sd=st(dayOf(t));sd.delays++;if(o.carrier==='D')sd.delaysD++}
        o.outAt=nextBiz(dayOf(o.outAt)+1)*1440+480+ri(0,90);
        if(rules.delayAlerts){st(dayOf(t)).alerts++;o.flags.alerted=true;addH(o,t,`Missed hub connection in ${o.hub}. Delay alert sent before the client asked`,'bad');
          msg(o,t,`Heads up: your parcel missed a connection in ${o.hub}. New estimate ${fmtDay(o.outAt)} by 5pm. No action needed.`,'bad')}
        else{addH(o,t,`Missed hub connection in ${o.hub}. Client not told (alerts off)`,'bad');o.chaseAt=t+ri(240,600)}
        o.nextAt=o.outAt;break}
      o.stage=7;addH(o,t,'Out for delivery');msg(o,t,'Out for delivery today.');o.nextAt=t+ri(90,420);break;
    case 7:
      if(o.flags.badAddr&&!o.failedOnce){o.failedOnce=true;st(dayOf(t)).failed++;o.stage=6;
        addH(o,t,`Delivery failed: ${o.missing} missing. Back to depot`,'bad');msg(o,t,`We couldn’t deliver today because the ${o.missing} was missing. We’ll try again next business day.`,'bad');
        o.outAt=nextBiz(dayOf(t)+1)*1440+480+ri(0,90);o.nextAt=o.outAt;break}
      {o.stage=8;o.deliveredAt=t;o.onTime=t<=o.promiseEnd;const s=st(dayOf(t));s.del++;if(o.onTime)s.ontime++;
      else s[o.flags.delay?(o.carrier==='D'?'lateDelayD':'lateDelay'):o.failedOnce?'lateFailed':o.flags.missedPickup?'latePickup':'lateOther']++;
      dlog.push({id:o.id,day:dayOf(t),carrier:o.carrier,region:o.dest.region,city:o.dest.city,client:o.client.name,wh:o.wh,onTime:o.onTime,delayed:!!o.flags.delay,hub:o.hub||null,alerted:!!o.flags.alerted,failed:!!o.failedOnce,missedPickup:!!o.flags.missedPickup,transfer:!!o.flags.transfer,late:o.onTime?0:Math.max(1,Math.round((t-o.promiseEnd)/60))});
      const c=cs(o.ci);c.del++;if(o.onTime)c.ontime++;const k=carrierStats[o.carrier];k.del++;if(o.onTime)k.ontime++;
      addH(o,t,o.onTime?'Delivered on time':'Delivered late',o.onTime?'ok':'bad');msg(o,t,`Delivered at ${fmtT(t)}. Signed for at ${o.dest.street}.`,'ok');o.nextAt=Infinity;break}
  }
}
function replenish(day){
  if(!rules.weeklyAllocation)return;
  for(const p of PRODUCTS){const ws=WHS.filter(w=>carries(p,w.id)),tot=ws.reduce((a,w)=>a+p.stock[w.id],0);
    for(const w of ws)if(lowAt(p,w.id)){p.stock[w.id]=Math.max(p.stock[w.id],Math.round(tot/ws.length),p.reorder[w.id]+40);st(day).topups++}}
}
let lastReplDay=-1;
function process(){
  while(simNow>=nextArrival){
    newOrder(nextArrival);
    const d=dayOf(nextArrival),m=nextArrival-d*1440;
    nextArrival+=(!isWeekend(d)&&m>390&&m<1050)?ri(5,16):ri(45,120);
  }
  const d=dayOf(simNow);if(d!==lastReplDay&&simNow-d*1440>=300){lastReplDay=d;
    // The allocation agent's rebalance runs on the week's first day, and the 4th too in an agent run: products below a reorder point or with stock-outs so far.
    if(live&&rules.weeklyAllocation&&(runMode==='agents'?[0,3]:[0]).includes(d-weekFrom(weekNo)))live.onWeeklyAllocation(PRODUCTS.filter(p=>lowAny(p)||Object.values(p.demand).some(x=>x.missed>0)).map(p=>({id:p.id,name:p.name})));
    replenish(d)}
  // At the 08:00 cutoff the carrier agent plans the same-day orders that came in before it.
  if(d!==lastCutoffDay&&!isWeekend(d)&&simNow-d*1440>=480){lastCutoffDay=d;
    if(live)live.onCutoff(orders.filter(o=>dayOf(o.arrival)===d&&o.arrival-d*1440<480).slice(0,12)
      .map(o=>({id:o.id,warehouse:o.wh?whName(o.wh):null,city:o.dest.city,state:o.dest.st,region:o.dest.region})))}
  for(const o of orders){let g=0;while(o.nextAt<=simNow&&g++<12)advance(o);
    if(o.chaseAt&&o.chaseAt<=simNow&&!o.chased){o.chased=true;st(dayOf(simNow)).chases++;addH(o,o.chaseAt,`${o.client.contact} emailed asking where the order is`,'bad')}}
  for(let i=orders.length-1;i>=0;i--){const o=orders[i];if(o.stage===8&&o.deliveredAt<simNow-2880&&o.ci!==0)orders.splice(i,1)}
}
function resolveAddress(o,by,val){
  if(!o||o.stage!==2||!o.held)return;
  if(val){o.dest=o.missing==='ZIP code'?{...o.dest,zip:val}:{...o.dest,unit:val}}
  o.fixedBy=by;o.nextAt=simNow;process();
}
/* start: the current time with no orders and the clock stopped; orders begin arriving once the demo clock is resumed */
simNow=STARTED.getHours()*60+STARTED.getMinutes();nextArrival=simNow+1;
const byId=id=>orders.find(o=>o.id===id);
// The day the demo clock started, and the counters of days from..to added up; runTotals() is the whole simulation.
const RUN_START=dayOf(STARTED.getHours()*60+STARTED.getMinutes());
function totals(from,to){const t=Object.fromEntries(STAT_KEYS.map(k=>[k,0]));
  for(let d=from;d<=to;d++){const s=stats[d];if(s)for(const k of STAT_KEYS)t[k]+=s[k]}return t}
const runTotals=()=>totals(RUN_START,dayOf(simNow));
// The clock runs a week at a time: it stops at midnight after the 7th day (counting the start day) and writes that
// week's report; play runs the next week. A run carries on through the week ends until runTo, its last week, writing
// each week's report as it goes: 'months' (runMonths) at the chosen speed, or 'agents' (runAgents), which holds the clock
// whenever a live agent has a call queued or running, so none is skipped. waitingOnAgents: the clock is held right now.
const WEEK_DAYS=7;let weekNo=1,runTo=0,runMode='',waitingOnAgents=false;const weekReports=[];
const weekEndAt=()=>(RUN_START+WEEK_DAYS*weekNo)*1440;
const weekFrom=k=>RUN_START+WEEK_DAYS*(k-1);
function last24(){let del=0,on=0;for(const o of orders)if(o.stage===8&&o.deliveredAt>simNow-1440){del++;if(o.onTime)on++}return {del,on}}
const myOrders=()=>orders.filter(o=>o.ci===S.user.client);

// The header badges and the demo clock belong to the layout; it reads them with status() whenever subs are told.
const subs=new Set();let status=null;
// The client's emailed orders from the API (setEmailed), for Messages and its badge.
let emailed=[];
// Staff: how many emailed orders need a person (setEmailExceptions), added to the Exceptions badge.
let emailExceptions=0;
function emit(){
  const next={clock:fmtDT(simNow),zone:ZONE,paused,speed,week:weekNo,runTo,runMode,waitingOnAgents,agents:!!live,weekDay:Math.min(WEEK_DAYS,dayOf(simNow)-weekFrom(weekNo)+1),
    exceptions:S.user.role==='admin'?orders.filter(o=>o.held||(o.flags.delay&&o.stage<8&&!o.flags.alerted)||(o.flags.badAddr&&o.stage<8)).length+emailExceptions:0,
    messages:S.user.role==='client'?myOrders().filter(o=>o.held).length+emailed.filter(r=>r.attn).length:0,
    stockoutsToday:st(dayOf(simNow)).stockouts,weeklyAllocation:rules.weeklyAllocation};
  if(status&&Object.keys(next).every(k=>next[k]===status[k]))return;
  status=next;for(const fn of subs)fn();
}

/* ===================== views: components/portal ===================== */
// Everything the views read; simNow, weekNo and emailed change, so they are read through getters.
const ctx={navigate,listen,S,byId,myOrders,orders,events,rules,st,cs,carrierStats,addH,msg,newOrder,process,resolveAddress,
  weekReports,last24,emit,RUN_START,WEEK_DAYS,weekFrom,totals,runTotals,BASE,dayOf,isWeekend,nextBiz,fmtT,fmtD,fmtDT,fmtDay,ri,pick,
  WHS,WH_OF,whName,whCity,CLIENTS,PRODUCTS,carries,lowAt,lowAny};
Object.defineProperties(ctx,{simNow:{get:()=>simNow},weekNo:{get:()=>weekNo},emailed:{get:()=>emailed}});
Object.assign(ctx,createParts(ctx));
Object.assign(ctx,createMap(ctx));
Object.assign(ctx,createPager(ctx));
Object.assign(ctx,createRouter(ctx));
ctx.VIEWS=createViews(ctx);
Object.assign(ctx,createComposer(ctx));
createEvents(ctx);
const {show,updateView,stageLabel,tone,distText,progress}=ctx;

/* ===================== loop + boot ===================== */
let lastRender=0;
function stopRun(){runTo=0;runMode='';waitingOnAgents=false;if(live)live.setWaiting(false)}
function endWeek(){
  const from=weekFrom(weekNo),to=from+WEEK_DAYS-1,t=totals(from,to);
  weekReports.unshift({week:weekNo,from,to,t,rules:{...rules},log:dlog.filter(x=>x.day>=from&&x.day<=to),agents:live?live.takeWeek():null,agentRun:runMode==='agents',whName});
  if(runTo>weekNo){weekNo++;emit();updateView(true);return}
  if(runTo){const r=runTotals();toast(`${runMode==='agents'?'Agent':'Long'} run done: ${pctOf(r.ontime,r.del)} on time so far. Reports on the Simulation page`);stopRun()}
  else toast(`Week ${weekNo} done: ${pctOf(t.ontime,t.del)} on time. Report on the Simulation page`);
  weekNo++;paused=true;emit();updateView(true)
}
timer=setInterval(()=>{
  // An hour at most per step, so fast speeds don't jump over the 08:00 cutoff or the day's allocation; ten minutes in an
  // agent run, so the clock stops soon after whatever the agents were handed.
  const holding=runMode==='agents'&&live;let held=false;
  for(let left=speed;left>0&&!paused;){if(holding&&live.busy()){held=true;break}
    const step=Math.min(left,holding?10:60);left-=step;
    simNow=Math.min(simNow+step,weekEndAt());process();if(simNow>=weekEndAt())endWeek()}
  if(held!==waitingOnAgents){waitingOnAgents=held;emit()}
  const now=performance.now();if(now-lastRender>250){lastRender=now;updateView(false)}
},100);
S.user={...user,client:myClient};
// Real admins only: the engine's 'admin' role is every staff member, and /api/simulation is admin-only.
if(user.role==='admin'&&user.canEditRules)live=createLiveAgents({clock:()=>fmtDT(simNow),warehouseName:whName,
  snapshot:id=>{const p=PRODUCTS.find(x=>x.id===id);return p?{productId:id,stock:{...p.stock},demand:JSON.parse(JSON.stringify(p.demand))}:null},setCarrier:(region,carrier)=>{liveCarrier[region]=carrier},
  // The agents are given the simulation's stock, so a transfer is limited only if the simulation moved on while it was thinking.
  applyTransfers(productId,ts){const p=PRODUCTS.find(x=>x.id===productId);let moved=0;if(!p)return 0;
    for(const t of ts){if(!(t.source in p.stock)||!(t.destination in p.stock))continue;const q=Math.min(t.quantity,p.stock[t.source]);p.stock[t.source]-=q;p.stock[t.destination]+=q;moved+=q}
    return moved}});
emit();
return {
  show,
  subscribe(fn){subs.add(fn);return ()=>subs.delete(fn)},
  status:()=>status,
  togglePause(){paused=!paused;emit()},
  setSpeed(s){speed=s;emit()},
  // Runs the clock non-stop for `months` from now, to the end of the week that reaches it; again stops the run at this week's end.
  runMonths(months){
    if(runMode==='months'){stopRun();emit();return}
    stopRun();runMode='months';
    const now=new Date(BASE.getTime()+simNow*60000),until=new Date(now);until.setMonth(until.getMonth()+months);
    const endDay=simNow/1440+(until.getTime()-now.getTime())/86400000;
    runTo=Math.max(weekNo,Math.ceil((endDay-RUN_START)/WEEK_DAYS));paused=false;emit();
    toast(`Running to the end of week ${runTo}. Each week's report is written as it ends`)},
  // Staff: runs this week and the next with the live agents, holding the clock while any call is queued or running, so
  // every email, cutoff, stock-out and weekly rebalance is answered by the agent; again stops the run at this week's end.
  runAgents(){
    if(!live)return;
    if(runMode==='agents'){stopRun();emit();return}
    stopRun();runMode='agents';runTo=weekNo+1;live.setWaiting(true);paused=false;emit();
    toast(`Agent run to the end of week ${runTo}. The clock waits for every agent call`)},
  setEmailed(list){emailed=list;updateView(true)},
  setEmailExceptions(n){emailExceptions=n;emit()},
  addressHolds(){
    return orders.filter(o=>o.held).sort((a,b)=>a.arrival-b.arrival).map(o=>({id:o.id,client:o.client.name,channel:o.channel,missing:o.missing,
      address:[o.dest.street,o.dest.city].filter(Boolean).join(', '),since:BASE.getTime()+((o.hist.find(h=>h.stage===2)||{}).t||o.arrival)*60000,
      suggestion:o.missing==='ZIP code'?o.dest.zip:o.dest.unit}))},
  releaseAddress(id){const o=byId(id);if(!o)return;const val=o.missing==='ZIP code'?o.dest.zip:o.dest.unit;resolveAddress(o,'ops',val);toast(`${o.id} released to the pick list`);updateView(true)},
  orderRows(){
    const list=S.user.role==='client'?myOrders():orders;
    return list.map(o=>{const late=!!(o.flags.delay&&o.stage<8),d=o.dest,intake=o.hist.find(h=>h.stage===3);
      return {id:o.id,client:o.client.name,product:o.product.name,sku:o.product.sku,qty:o.qty,channel:o.channel,
        arrival:BASE.getTime()+o.arrival*60000,intake:intake?BASE.getTime()+intake.t*60000:null,
        address:`${d.street}, ${o.missing==='suite number'?'':d.unit+', '}${d.city}, ${d.st}${o.missing==='ZIP code'?'':' '+d.zip}`,status:stageLabel(o),tone:tone(o),held:!!o.held,delayed:late,delivered:o.stage===8,
        from:whCity(o.wh||WH_OF[o.dest.region]),to:o.dest.city,distance:distText(o),warehouse:o.wh?whCity(o.wh):null,
        carrier:o.carrier?'Carrier '+o.carrier:null,
        progress:o.stage===8?1:Math.max(progress(o),[0,.04,.06,.12,.2,.28][Math.min(o.stage,5)]||0),
        promise:o.promiseEnd?fmtD(late?o.outAt:o.promiseEnd):null,late}}).sort((a,b)=>b.arrival-a.arrival)},
  dispose,
};
}
