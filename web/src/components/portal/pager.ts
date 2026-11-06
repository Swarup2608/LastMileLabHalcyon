/* eslint-disable */
// @ts-nocheck
import { ic } from "@/components/portal/icons";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, clampPage, pageCountOf, pageItems, pageSummary } from "@/lib/pagination";
import { esc } from "@/lib/portal/utils/dom";

export function createPager(ctx){
const {S}=ctx;
/* tables: one page of `list` plus the pager under it, the same markup as components/Pagination.tsx. Each table
   keeps its page and rows per page in S.f.pg[key]; the click and change listeners in events.ts update them. */
function paged(key,list,noun){
  const pg=(S.f.pg||={})[key]||={page:1,size:DEFAULT_PAGE_SIZE};
  const page=pg.page=clampPage(pg.page,list.length,pg.size),size=pg.size,n=pageCountOf(list.length,size);
  const rows=list.slice((page-1)*size,page*size);
  if(list.length<=PAGE_SIZES[0])return {rows,pager:''};
  const step=(to,dir)=>`<button class="pager-step" type="button" data-pg="${key}" data-pgto="${to}" data-key="pg-${key}-${dir}"${to<1||to>n?' disabled':''} aria-label="${dir==='prev'?'Previous':'Next'} page">${dir==='prev'?`${ic('caret-left')}<span>Previous</span>`:`<span>Next</span>${ic('caret-right')}`}</button>`;
  return {rows,pager:`<nav class="pager" aria-label="${esc(noun)} pages">${step(page-1,'prev')}
    <ol class="pager-pages">${pageItems(page,n).map((it,i)=>it==='gap'?'<li class="pager-gap" aria-hidden="true">…</li>':`<li><button class="pager-num" type="button" data-pg="${key}" data-pgto="${it}" data-key="pg-${key}-${it}" aria-label="Page ${it}"${it===page?' aria-current="page"':''}>${it}</button></li>`).join('')}</ol>
    ${step(page+1,'next')}
    <label class="pager-size"><span>Rows per page</span><select class="select" data-pgsize="${key}" data-key="pgs-${key}">${PAGE_SIZES.map(s=>`<option value="${s}"${s===size?' selected':''}>${s}</option>`).join('')}</select></label>
    <span class="pager-sum" aria-live="polite">${pageSummary(page,size,list.length,noun)}</span></nav>`};
}
const pgSig=()=>JSON.stringify(S.f.pg||{});
return {paged,pgSig};
}
