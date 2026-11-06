/* eslint-disable */
// @ts-nocheck
// Small DOM helpers shared by the portal engine's HTML views.
import hotToast from "react-hot-toast";

export const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
export function enter(el){if(!el.animate)return;el.animate(reduceMotion()?[{opacity:0},{opacity:1}]:[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:200,easing:'cubic-bezier(0.23,1,0.32,1)'})}
// Confirmations go through the site-wide react-hot-toast host (<AppToaster/> in the portal layout).
export function toast(text){hotToast.success(text)}
