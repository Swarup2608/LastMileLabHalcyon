/* eslint-disable */
// @ts-nocheck
// The live network map and an order's route map, and where an order is on its way.
import { esc } from "@/lib/portal/utils/dom";
import { DOTS, MH, MW, P, laneAt, lanePath, miles } from "@/lib/portal/utils/geo";

export function createMap(ctx){
const {S,WHS,WH_OF,byId,orders,stageLabel,whCity}=ctx;
const LL={...Object.fromEntries(WHS.map(w=>[w.id,w.at])),
 Eugene:[44.05,-123.09],Denver:[39.74,-104.99],'Grand Rapids':[42.96,-85.67],Chicago:[41.88,-87.63],'Kansas City':[39.1,-94.58],Atlanta:[33.75,-84.39],Tampa:[27.95,-82.46],Columbia:[34.0,-81.03],Dallas:[32.78,-96.8],Austin:[30.27,-97.74],Portland:[43.66,-70.26],Philadelphia:[39.95,-75.17]};
const distText=o=>{const m=miles(fromLL(o),destLL(o));return m<40?'Local delivery':m.toLocaleString('en-US')+' mi'};
const destLL=o=>LL[o.dest.city]||LL[WH_OF[o.dest.region]];
const fromLL=o=>LL[o.wh||WH_OF[o.dest.region]];
function progress(o){
  if(o.stage===8)return 1;if(o.stage<6)return 0;
  if(o.stage===6){const a=o.collectAt||ctx.simNow,b=o.outAt||ctx.simNow+1;return Math.max(0,Math.min(1,(ctx.simNow-a)/Math.max(1,b-a)))*.88}
  const h=o.hist.find(x=>x.stage===7);return .88+.11*Math.max(0,Math.min(1,(ctx.simNow-(h?h.t:ctx.simNow))/300));
}
const mkColor=o=>o.flags.delay&&o.stage<8?'var(--bad)':o.carrier==='D'?'var(--orange)':o.stage===7?'var(--s6)':'var(--blue)';
function netMap(dyn,label,whs=true){
  return `<svg class="map" viewBox="0 0 ${MW} ${MH}" role="img" aria-label="${esc(label)}"><g class="map-dots">${DOTS}</g><g data-dyn="${dyn}"></g>${whs?`<g class="map-wh">${WHS.map(w=>{const[x,y]=P(LL[w.id]);return `<g><circle class="ring" cx="${x}" cy="${y}" r="8"/><circle class="core" cx="${x}" cy="${y}" r="3.5"/><text x="${x+12}" y="${y+4}">${whCity(w.id)}</text></g>`}).join('')}</g>`:''}</svg>`;
}
function dynNet(){
  const list=orders.filter(o=>o.stage===6||o.stage===7);
  return list.map(o=>`<path class="lane" d="${lanePath(fromLL(o),destLL(o))}" stroke="${mkColor(o)}" stroke-opacity=".28" stroke-dasharray="3 4"/>`).join('')+
    list.map(o=>{const[x,y]=laneAt(fromLL(o),destLL(o),progress(o));const c=mkColor(o);return `<g class="mk" data-order="${o.id}" role="button" tabindex="0" aria-label="${o.id}, ${esc(o.client.name)}, ${stageLabel(o)}">${o.flags.delay&&o.stage<8?`<circle class="halo" cx="${x}" cy="${y}" r="10" fill="${c}"/>`:''}<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${c}"/><title>${o.id} · ${esc(o.client.name)} · ${stageLabel(o)}</title></g>`}).join('');
}
function dynOrder(o){
  if(!o)return '';
  const a=fromLL(o),b=destLL(o),p=progress(o),[dx,dy]=P(b),c=o.flags.delay&&o.stage<8?'var(--bad)':'var(--orange)';
  const [tx,ty]=laneAt(a,b,p);
  return `<path class="lane" d="${lanePath(a,b)}" stroke="var(--brand)" stroke-opacity=".25" stroke-width="3" stroke-dasharray="2 6"/>
    <path class="lane" d="${lanePath(a,b)}" stroke="${c}" stroke-width="3.5" pathLength="1" stroke-dasharray="${p.toFixed(3)} 1"/>
    <g><circle cx="${dx}" cy="${dy}" r="14" fill="${c}" opacity=".15"/><circle cx="${dx}" cy="${dy}" r="6" fill="${c}" stroke="var(--surface)" stroke-width="2"/><text x="${dx+12}" y="${dy-10}" style="font:600 12px var(--font);fill:var(--text);paint-order:stroke;stroke:var(--surface);stroke-width:4px">${esc(o.dest.city)}</text></g>
    ${o.stage>=6&&o.stage<8?`<g><circle class="halo" cx="${tx}" cy="${ty}" r="12" fill="${c}"/><circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="8" fill="var(--brand)" stroke="var(--surface)" stroke-width="2.5"/><circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3" fill="var(--brand-accent)"/></g>`:''}`;
}
function renderMaps(){document.querySelectorAll('[data-dyn]').forEach(g=>{const k=g.dataset.dyn;let html='';
  if(k==='net')html=dynNet();else if(k.startsWith('o:'))html=dynOrder(byId(k.slice(2)));else if(k==='est'&&S.est)html=dynOrder(S.est);
  if(g.dataset.h!==html){g.dataset.h=html;g.innerHTML=html}})}
return {LL,distText,destLL,fromLL,progress,mkColor,netMap,dynNet,dynOrder,renderMaps};
}
