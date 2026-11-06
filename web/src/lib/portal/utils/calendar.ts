/* eslint-disable */
// @ts-nocheck
// The demo clock's calendar: times are minutes from midnight of `started`'s day (day 0).
const DN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],DL=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function createCalendar(started){
const BASE=new Date(started.getFullYear(),started.getMonth(),started.getDate());
const dayOf=t=>Math.floor(t/1440);
const dateOf=d=>{const x=new Date(BASE);x.setDate(x.getDate()+d);return x};
const isWeekend=d=>{const g=dateOf(d).getDay();return g===0||g===6};
const nextBiz=d=>{while(isWeekend(d))d++;return d};
const fmtT=t=>{const m=((Math.floor(t)%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
const fmtD=t=>{const x=dateOf(dayOf(t));return `${DN[x.getDay()]} ${x.getDate()} ${MN[x.getMonth()]}`};
const fmtDT=t=>`${fmtD(t)}, ${fmtT(t)}`;
const fmtDay=t=>{const x=dateOf(dayOf(t));return `${DL[x.getDay()]} ${x.getDate()} ${MN[x.getMonth()]}`};
return {BASE,dayOf,dateOf,isWeekend,nextBiz,fmtT,fmtD,fmtDT,fmtDay};
}
