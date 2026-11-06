/* eslint-disable */
// @ts-nocheck
// The client's "Email an order" composer (the <dialog> is in <ConsoleShell/>): sends a simulated email order.
import { toast } from "@/lib/portal/utils/dom";
import { BOOK, DEST } from "@/lib/portal/world";

export function createComposer(ctx){
const {CLIENTS,PRODUCTS,S,go,newOrder,pick,process,ri}=ctx;
const dlg=document.querySelector('[data-composer]'),cBody=dlg.querySelector('[data-cmp-body]'),cErr=dlg.querySelector('[data-cmp-err]'),cSend=dlg.querySelector('[data-cmp-send]');
function openComposer(){
  if(!S.user||S.user.role!=='client')return;
  const mine=PRODUCTS.filter(x=>x.client===S.user.client);if(!mine.length){toast('No products are stocked for your account yet');return}
  const c=CLIENTS[S.user.client],b=BOOK[ri(0,BOOK.length-1)],d=DEST[b.d],p=pick(mine),qty=ri(4,24),po=String(ri(52000,58999));
  cBody.value=`Hi Halcyon team,\n\nPlease ship ${qty} cartons of ${p.sku} ${p.name} (PO ${po}) to:\n${d.street}\n${d.unit}\n${d.city}, ${d.st} ${d.zip}\n\nThanks,\n${c.contact.split(' ')[0]}\n${c.name}`;
  cErr.hidden=true;cBody.removeAttribute('aria-invalid');cSend.disabled=false;cSend.textContent='Send email';dlg.showModal();
}
dlg.querySelector('[data-cmp-cancel]').addEventListener('click',()=>dlg.close());
dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close()});
cSend.addEventListener('click',()=>{
  const body=cBody.value.trim(),qm=body.match(/(\d+)\s*(cartons?|cases?|units?|boxes)/i);
  const dest=DEST.find(d=>body.toLowerCase().includes(d.city.toLowerCase()));
  const prod=PRODUCTS.filter(p=>p.client===S.user.client).find(p=>body.includes(p.sku));
  if(!body||!qm||!dest||!prod){cErr.hidden=false;cErr.textContent=!qm?'Add a quantity, for example “12 cartons”.':!prod?`Mention one of your SKUs, for example ${PRODUCTS.find(p=>p.client===S.user.client)?.sku||'its SKU'}.`:`Use one of the demo cities: ${DEST.map(d=>d.city).join(', ')}.`;cBody.setAttribute('aria-invalid','true');cBody.focus();return}
  const zm=body.match(new RegExp(dest.city+',?\\s*'+dest.st+'\\s+(\\d{5})\\b','i'));
  cSend.disabled=true;cSend.textContent='Sending…';
  setTimeout(()=>{
    const pm=body.match(/PO\s*(\d{4,6})/i);
    const o=newOrder(ctx.simNow,{ci:S.user.client,channel:'email',product:prod,qty:+qm[1],dest:zm?{...dest,zip:zm[1]}:{...dest},missing:zm?null:'ZIP code',po:pm?pm[1]:undefined,body,subject:`PO ${pm?pm[1]:''} · ${qm[1]} cartons`,user:true});
    o.nextAt=ctx.simNow;process();dlg.close();toast(`Email received as ${o.id}`);go('order',o.id);
  },350);
});
return {openComposer};
}
