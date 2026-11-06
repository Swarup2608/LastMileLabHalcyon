/* eslint-disable */
// @ts-nocheck
// Draws the current engine view into the page body React hands over, and redraws it as the simulation runs.
import { viewPath } from "@/lib/portal/types";
import { enter, reduceMotion } from "@/lib/portal/utils/dom";

export function createRouter(ctx){
const {S,emit,navigate,renderMaps}=ctx;
function go(view,param){navigate(viewPath(view,param))}
function show(el,view,param){
  S.main=el;S.view=view;S.param=param||null;renderView();
  return ()=>{if(S.main===el){S.main=null;S.est=null}};
}
function renderView(){
  const main=S.main,V=currentView();if(!V)return;
  main.innerHTML=V.shell?V.shell():'';
  V.regionSig=null;
  if(V.mount)V.mount(main);
  updateView(true);
  if(!reduceMotion())enter(main);
}
function currentView(){return S.user&&S.main?(ctx.VIEWS[S.user.role][S.view]||ctx.VIEWS[S.user.role].overview):null}
function updateView(force){
  emit();
  const V=currentView();if(!V)return;
  if(V.region){
    const reg=document.querySelector('[data-region]');if(!reg)return;
    const sig=V.sig?V.sig():Math.random();
    if(!force&&sig===V.regionSig)return;V.regionSig=sig;
    const ae=document.activeElement,key=ae&&ae.dataset&&ae.dataset.key;
    reg.innerHTML=V.region();
    if(key){const el=reg.querySelector(`[data-key="${CSS.escape(key)}"]`);if(el)el.focus({preventScroll:true})}
    if(V.after)V.after(reg,force);
  }
  if(V.update)V.update(force);
  if(V.tick)V.tick();
  renderMaps();
}
return {go,show,renderView,currentView,updateView};
}
