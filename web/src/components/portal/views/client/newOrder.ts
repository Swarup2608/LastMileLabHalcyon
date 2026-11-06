/* eslint-disable */
// @ts-nocheck
// The client's New order form, with a live delivery estimate.
import { ic } from "@/components/portal/icons";
import { esc, toast } from "@/lib/portal/utils/dom";
import { miles } from "@/lib/portal/utils/geo";
import { BOOK, DEST } from "@/lib/portal/world";

export function createClientNewOrder(ctx){
const {LL,PRODUCTS,S,WCOL,WHS,WH_OF,dayOf,fmtDay,fmtT,go,isWeekend,netMap,newOrder,nextBiz,pTot,process,renderMaps,rules,whCity,whName}=ctx;
function estimate(p,qty,dest){
  const home=WH_OF[dest.region],ok=p.stock[home]>=qty;
  const wh=ok?home:WHS.map(w=>w.id).filter(w=>w!==home).sort((a,b)=>p.stock[b]-p.stock[a])[0];
  let d=dayOf(ctx.simNow),m=ctx.simNow-d*1440,wave,name;
  if(isWeekend(d)){d=nextBiz(d);wave=d*1440+540;name='Morning wave'}
  else if(m<480){wave=d*1440+540;name='Morning wave'}
  else if(m<780&&rules.afternoonWave){wave=d*1440+840;name='Afternoon wave'}
  else{d=nextBiz(d+1);wave=d*1440+540;name='Next morning wave'}
  return {home,ok,wh,wave,name,deliver:nextBiz(dayOf(wave)+(ok?1:2))*1440+1020};
}
return {parent:'new',
  shell(){
    const prods=PRODUCTS.filter(p=>p.client===S.user.client);
    if(!prods.length)return `<div class="page-h"><div><p class="kick">Place an order</p><h1>New order</h1></div></div><div class="card empty">${ic('cube','lg')}No products are stocked with Halcyon for your account yet, so there is nothing to order.</div>`;
    const pre=S.f.prefill||prods[0].sku;
    return `<div class="page-h"><div><p class="kick">Place an order</p><h1>New order</h1><p>Goes straight into the pick list. Before 08:00 it ships this morning; until 13:00 it joins the afternoon wave.</p></div></div>
    <form class="no-grid" data-neworder novalidate>
      <div class="no-steps">
        <section class="card no-step"><div class="no-h"><span class="num">1</span>Choose a product<span class="r">${prods.length} products</span></div>
          <div class="pick" role="radiogroup" aria-label="Product">${prods.map((p,i)=>`<label class="opt" style="--c:var(${WCOL[i%WCOL.length]})"><input type="radio" name="sku" value="${p.sku}"${p.sku===pre?' checked':''}><span class="pc-tile">${ic('cube')}</span><span class="t">${esc(p.name)}<span>${p.sku} · ${pTot(p)} in stock</span></span><span class="ck">${ic('check')}</span></label>`).join('')}</div></section>
        <section class="card no-step"><div class="no-h"><span class="num">2</span>Quantity</div>
          <div class="qty"><div class="stepper"><button type="button" data-q="-1" aria-label="One fewer carton">${ic('minus')}</button><label class="sr" for="qty">Cartons</label><input class="input" id="qty" name="qty" type="number" min="1" max="200" value="10" inputmode="numeric" data-key="qty" aria-describedby="qty-err"><button type="button" data-q="1" aria-label="One more carton">${ic('plus')}</button></div>
            <div class="qchips">${[5,10,20,40].map(n=>`<button type="button" data-qset="${n}">${n}</button>`).join('')}</div><span class="muted" style="font-size:14px;line-height:20px">cartons</span></div>
          <span class="ferr" id="qty-err" data-err="qty" hidden></span>
          <label class="field" style="max-width:280px">Your PO number <span class="help">Optional</span><input class="input" name="po" data-key="po" placeholder="e.g. 55120"></label></section>
        <section class="card no-step"><div class="no-h"><span class="num">3</span>Ship to</div>
          <div class="pick" role="radiogroup" aria-label="Delivery address">${BOOK.map((b,i)=>{const d=DEST[b.d];return `<label class="opt" style="--c:var(--blue)"><input type="radio" name="addr" value="${i}"${i===0?' checked':''}><span class="pc-tile">${ic('storefront')}</span><span class="t">${esc(b.label)}<span>${esc(d.street)}, ${esc(d.city)} ${d.st}</span></span><span class="ck">${ic('check')}</span></label>`}).join('')}
            <label class="opt" style="--c:var(--orange)"><input type="radio" name="addr" value="new"><span class="pc-tile">${ic('plus')}</span><span class="t">New address<span>Ship somewhere else</span></span><span class="ck">${ic('check')}</span></label></div>
          <div data-newaddr style="display:none;gap:16px">
            <div class="grid2"><label class="field">Street<input class="input" name="street" data-key="street" autocomplete="address-line1"><span class="ferr" data-err="street" hidden></span></label>
            <label class="field">Suite or unit<input class="input" name="unit" data-key="unit" autocomplete="address-line2"></label></div>
            <div class="grid2"><label class="field">City<select class="select" name="city" data-key="city">${DEST.map((d,i)=>`<option value="${i}">${esc(d.city)}, ${d.st}</option>`).join('')}</select></label>
            <label class="field">ZIP code<input class="input" name="zip" data-key="zip" inputmode="numeric" maxlength="5" autocomplete="postal-code"><span class="help">Leave empty to see the address check hold it</span><span class="ferr" data-err="zip" hidden></span></label></div>
          </div></section>
      </div>
      <aside class="card no-sum" aria-label="Order summary">
        <div class="map-wrap">${netMap('est','Estimated route for this order')}</div>
        <div class="sum-b"><div data-sum style="display:grid;gap:16px"></div><button class="btn btn-cta" type="submit">${ic('paper-plane-tilt')}Place order</button><button class="btn btn-quiet" type="button" data-compose>${ic('envelope-simple')}Or simulate an email order</button></div>
      </aside>
    </form>`},
  read(f){
    const p=PRODUCTS.find(x=>x.sku===(f.querySelector('[name=sku]:checked')||{}).value)||PRODUCTS.find(x=>x.client===S.user.client);
    const qty=parseInt(f.qty.value,10);let dest,missing=null,label;
    const a=(f.querySelector('[name=addr]:checked')||{}).value;
    if(a==='new'){const base=DEST[+f.city.value],zip=f.zip.value.trim();dest={...base,street:f.street.value.trim()||'New address',unit:f.unit.value.trim()||'Main entrance',zip:zip||base.zip};if(!zip)missing='ZIP code';label=`${dest.street}, ${dest.city}`}
    else{dest=DEST[BOOK[+a].d];label=BOOK[+a].label}
    return {p,qty,dest,missing,label,a};
  },
  refresh(){
    const f=document.querySelector('[data-neworder]');if(!f)return;const r=this.read(f);
    const q=r.qty>0?r.qty:0,e=estimate(r.p,q||1,r.dest);
    S.est={wh:e.wh,dest:r.dest,stage:3,flags:{},hist:[]};
    const s=f.querySelector('[data-sum]');
    s.innerHTML=`<div class="sum-eta"><span>${r.missing?'Estimated delivery, once you add the ZIP':'Estimated delivery'}</span><b>${fmtDay(e.deliver)}</b><span>by 5pm · ${e.name} at ${fmtT(e.wave)}</span></div>
      <dl class="sum-l"><dt>Product</dt><dd>${esc(r.p.name)}</dd><dt>Cartons</dt><dd class="mono">${q||'–'}</dd><dt>Ship to</dt><dd>${esc(r.label)}</dd>
      <dt>Ships from</dt><dd>${esc(whName(e.wh))}${e.ok?'':` <span class="chip warn">${esc(whCity(e.home))} is short</span>`}</dd><dt>Distance</dt><dd class="mono">${miles(LL[e.wh],LL[r.dest.city]).toLocaleString('en-US')} mi</dd></dl>
      ${r.missing?`<div class="callout warn">${ic('warning')}<span>No ZIP code. We’ll hold the order and ask you before it’s picked.</span></div>`:''}
      ${!e.ok?`<div class="callout warn">${ic('warehouse')}<span>Not enough ${esc(r.p.sku)} in ${esc(whCity(e.home))}, so it ships from ${esc(whCity(e.wh))} and takes a day longer.</span></div>`:''}
`;
    renderMaps();
  },
  mount(main){
    const f=main.querySelector('[data-neworder]'),na=main.querySelector('[data-newaddr]');if(!f)return;
    f.addEventListener('change',()=>{na.style.display=(f.querySelector('[name=addr]:checked')||{}).value==='new'?'grid':'none';this.refresh()});
    f.addEventListener('input',()=>this.refresh());
    f.addEventListener('click',e=>{const d=e.target.closest('[data-q]'),s=e.target.closest('[data-qset]');
      if(d){f.qty.value=Math.max(1,Math.min(200,(parseInt(f.qty.value,10)||0)+ +d.dataset.q));this.refresh()}
      if(s){f.qty.value=s.dataset.qset;this.refresh()}});
    f.addEventListener('submit',e=>{e.preventDefault();
      const r=this.read(f),errs={};
      if(!(r.qty>=1&&r.qty<=200))errs.qty='Enter between 1 and 200 cartons.';
      if(r.a==='new'){if(f.street.value.trim().length<4)errs.street='Enter the street address.';const z=f.zip.value.trim();if(z&&!/^\d{5}$/.test(z))errs.zip='Use a 5 digit ZIP code, or leave it empty.'}
      main.querySelectorAll('[data-err]').forEach(x=>{const k=x.dataset.err;x.hidden=!errs[k];x.textContent=errs[k]||'';if(f[k])f[k].toggleAttribute('aria-invalid',!!errs[k])});
      const first=Object.keys(errs)[0];if(first){f[first].focus();return}
      const o=newOrder(ctx.simNow,{ci:S.user.client,channel:'portal',product:r.p,qty:r.qty,dest:r.dest,missing:r.missing,po:f.po.value.trim()||undefined,user:true});
      o.nextAt=ctx.simNow;process();S.f.prefill=null;S.est=null;toast(`${o.id} placed`);go('order',o.id)});
    this.refresh();
  }
};

}
