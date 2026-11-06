/* eslint-disable */
// @ts-nocheck
// Clicks, rows-per-page changes and keys inside the engine's markup.
import { RULES } from "@/components/portal/views/admin/rules";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { viewPath } from "@/lib/portal/types";
import { toast } from "@/lib/portal/utils/dom";

export function createEvents(ctx){
const {S,addH,byId,dayOf,fmtDay,go,listen,msg,navigate,openComposer,resolveAddress,rules,st,updateView}=ctx;
listen('click',e=>{
  const t=e.target;
  // Only the engine's own markup (the current page body and the composer); the layout's header and footer are React.
  if(!(S.main&&S.main.contains(t))&&!t.closest('[data-composer]'))return;
  const pt=t.closest('[data-pgto]');if(pt){const p=(S.f.pg||={})[pt.dataset.pg]||={page:1,size:DEFAULT_PAGE_SIZE};p.page=+pt.dataset.pgto;updateView(true);return}
  const g=t.closest('[data-go]');if(g){e.preventDefault();go(g.dataset.go);return}
  const od=t.closest('[data-order]');if(od&&S.user){e.preventDefault();go('order',od.dataset.order);return}
  const fx=t.closest('[data-fix]');if(fx){const o=byId(fx.dataset.fix);resolveAddress(o,'ops',fx.dataset.val);toast(`${o.id} released to the pick list`);updateView(true);return}
  const cf=t.closest('[data-clientfix]');if(cf){clientFix(cf.dataset.clientfix);return}
  const ak=t.closest('[data-ack]');if(ak){S.f.ack=ak.dataset.ack;updateView(true);return}
  const nt=t.closest('[data-notify]');if(nt){const o=byId(nt.dataset.notify);o.flags.alerted=true;o.chaseAt=null;st(dayOf(ctx.simNow)).alerts++;addH(o,ctx.simNow,'Delay alert sent by operations','bad');msg(o,ctx.simNow,`Heads up: your parcel missed a connection in ${o.hub}. New estimate ${fmtDay(o.outAt)} by 5pm.`,'bad');toast(`Alert sent to ${o.client.contact}`);updateView(true);return}
  const rl=t.closest('[data-rule]');if(rl){const k=rl.dataset.rule;rules[k]=!rules[k];toast(`${RULES.find(r=>r[0]===k)[1]} turned ${rules[k]?'on':'off'}`);updateView(true);return}
  const ar=t.closest('[data-allrules]');if(ar){for(const k in rules)rules[k]=ar.dataset.allrules==='on';toast(`All rules turned ${ar.dataset.allrules}`);updateView(true);return}
  const op=t.closest('[data-orderprod]');if(op){S.f.prefill=op.dataset.orderprod;go('new');return}
  const co=t.closest('[data-clientorders]');if(co){navigate(`${viewPath('orders')}?q=${encodeURIComponent(co.dataset.clientorders)}`);return}
  if(t.closest('[data-compose]')){openComposer();return}
});
// Rows per page under an engine table; the table goes back to its first page.
listen('change',e=>{
  const s=e.target;if(!s.matches||!s.matches('[data-pgsize]')||!(S.main&&S.main.contains(s)))return;
  (S.f.pg||={})[s.dataset.pgsize]={page:1,size:+s.value};updateView(true);
});
listen('keydown',e=>{
  if((e.key==='Enter'||e.key===' ')&&e.target.matches('tr[data-order],g[data-order]')){e.preventDefault();go('order',e.target.dataset.order)}
  if(e.key==='Enter'&&e.target.matches('[data-fixin]')){e.preventDefault();clientFix(e.target.dataset.fixin)}
});
function clientFix(id){
  const o=byId(id),inp=document.querySelector(`[data-fixin="${id}"]`),err=document.querySelector(`[data-fixerr="${id}"]`);if(!o||!inp)return;
  const v=inp.value.trim(),ok=o.missing==='ZIP code'?/^\d{5}$/.test(v):v.length>=2;
  if(!ok){inp.setAttribute('aria-invalid','true');err.hidden=false;err.textContent=o.missing==='ZIP code'?'Enter the 5 digit ZIP code.':'Enter the suite or unit number.';inp.focus();return}
  resolveAddress(o,'client',v);toast(`Thanks. ${o.id} is back in the pick list`);updateView(true);
}

}
