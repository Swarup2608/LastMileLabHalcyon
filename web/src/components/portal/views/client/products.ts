/* eslint-disable */
// @ts-nocheck
// The client's Products: stock per warehouse.
import { ic } from "@/components/portal/icons";
import { esc } from "@/lib/portal/utils/dom";

export function createClientProducts(ctx){
const {PRODUCTS,S,WCOL,WHS,carries,lowAny,lowAt,myOrders,pTot,updateView,whCity,whName}=ctx;
return {
  shell(){return `<div class="page-h"><div><p class="kick">Inventory</p><h1>Products</h1><p>Your stock in every Halcyon warehouse, updated as orders ship.</p></div><div class="acts"><button class="btn btn-cta" type="button" data-go="new">${ic('plus')}New order</button></div></div>
    <div data-pstats></div>
    <div class="bar-row"><div class="ptabs" role="group" aria-label="Filter products">${[['all','All products'],['low','Low somewhere']].map(([k,l])=>`<button type="button" data-pf="${k}" aria-pressed="${(S.f.pf||'all')===k}">${l}</button>`).join('')}</div>
      <label class="searchbox"><span class="sr">Search products</span>${ic('magnifying-glass')}<input class="input" placeholder="Search by name or SKU" data-key="psearch" data-psearch value="${esc(S.f.psearch||'')}"></label></div>
    <div data-region></div>`},
  mount(main){main.querySelector('[data-psearch]').addEventListener('input',e=>{S.f.psearch=e.target.value;updateView(true)});
    main.querySelectorAll('[data-pf]').forEach(b=>b.addEventListener('click',()=>{S.f.pf=b.dataset.pf;main.querySelectorAll('[data-pf]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));updateView(true)}))},
  sig(){return PRODUCTS.filter(p=>p.client===S.user.client).map(p=>Object.values(p.stock).join('.')).join()+(S.f.psearch||'')+(S.f.pf||'')},
  region(){
    const mine=PRODUCTS.filter(p=>p.client===S.user.client);
    const st=document.querySelector('[data-pstats]');
    if(st){const tot=mine.reduce((a,p)=>a+pTot(p),0),low=mine.filter(lowAny).length,open=myOrders().filter(o=>o.stage<6).reduce((a,o)=>a+o.qty,0);
      st.innerHTML=`<div class="stats3"><div class="card stat" style="--c:var(--blue)"><span class="kpi-ic">${ic('cube','lg')}</span><div><b>${tot.toLocaleString('en-US')}</b><span>Cartons in stock, ${mine.length} products</span></div></div>
        <div class="card stat" style="--c:var(--orange)"><span class="kpi-ic">${ic('warning','lg')}</span><div><b>${low}</b><span>Products low in a warehouse</span></div></div>
        <div class="card stat" style="--c:var(--primary)"><span class="kpi-ic">${ic('package','lg')}</span><div><b>${open}</b><span>Cartons on open orders, not yet shipped</span></div></div></div>`}
    const q=(S.f.psearch||'').toLowerCase();
    const list=mine.filter(p=>(!q||p.name.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q))&&((S.f.pf||'all')==='all'||lowAny(p)));
    if(!list.length)return `<div class="card empty">${ic('cube','lg')}${q?`No products match “${esc(S.f.psearch)}”.`:mine.length?'Nothing is running low. Every product is above its reorder point in each warehouse that stocks it.':'No products are stocked with Halcyon for your account yet.'}</div>`;
    return `<div class="pcgrid">${list.map(p=>{const i=mine.indexOf(p),c=WCOL[i%WCOL.length],tot=pTot(p),max=Math.max(40,...Object.values(p.stock));
      const low=WHS.filter(w=>lowAt(p,w.id)),best=WHS.slice().sort((a,b)=>p.stock[b.id]-p.stock[a.id])[0];
      return `<article class="card pcard" style="--c:var(${c})"><div class="pc-top"><span class="pc-tile">${ic('cube')}</span><div><h3>${esc(p.name)}</h3><div class="sku">${p.sku}</div></div>${low.length?`<span class="chip warn">Low in ${low.length===1?esc(whCity(low[0].id)):low.length+' sites'}</span>`:'<span class="chip ok">In stock</span>'}</div>
        <div class="pc-total"><b>${tot}</b>cartons available</div>
        <div class="pc-cols" role="img" aria-label="${WHS.map(w=>whCity(w.id)+' '+(carries(p,w.id)?p.stock[w.id]:'not stocked')).join(', ')}">${WHS.map(w=>{const v=p.stock[w.id],c=carries(p,w.id);return `<div class="pc-col" title="${esc(whName(w.id))}: ${c?v+' cartons, reorder at '+p.reorder[w.id]:'not stocked here'}"><span class="v">${c?v:'–'}</span><span class="bb${!c?'':v===0?' out':lowAt(p,w.id)?' lo':''}" style="height:${c?Math.max(4,v/max*56):0}px"></span><span class="k">${w.id}</span></div>`}).join('')}</div>
        <div class="pc-foot"><p>Most stock in ${esc(whCity(best.id))}</p><button class="btn btn-secondary btn-sm" type="button" data-orderprod="${p.sku}">${ic('plus')}Order</button></div></article>`}).join('')}</div>`}
};

}
