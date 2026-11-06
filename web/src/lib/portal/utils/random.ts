/* eslint-disable */
// @ts-nocheck
// The engine's seeded random numbers: the same seed every start, so a demo plays out the same way.
export function createRandom(){
let seed=48340;
function rnd(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}
const ri=(a,b)=>a+Math.floor(rnd()*(b-a+1));
const pick=a=>a[Math.floor(rnd()*a.length)];
return {rnd,ri,pick};
}
