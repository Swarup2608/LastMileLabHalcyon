/* eslint-disable */
// @ts-nocheck
// The US map's projection and outline, the curved lanes drawn on it, and road miles between two points.
export const MW=640,MH=360;
export const P=([la,lo])=>[(lo+125.5)/59*MW,(50.2-la)/26.8*MH];
export const US=[[48.4,-124.7],[46.2,-123.9],[43.3,-124.4],[40.4,-124.4],[37.8,-122.5],[34.5,-120.6],[34,-118.5],[32.5,-117.1],[32.7,-114.7],[31.3,-111],[31.3,-108.2],[31.8,-106.5],[29.6,-104.5],[29,-103],[29.8,-101.4],[27.5,-99.5],[25.9,-97.4],[27.8,-97.4],[29.4,-94.7],[29.7,-93.8],[29.3,-91],[28.9,-89.4],[30.3,-89.2],[30.7,-88],[30.4,-86.5],[29.7,-85],[29.9,-83.7],[27.9,-82.6],[25.9,-81.7],[25.2,-80.4],[26.9,-80.1],[28.4,-80.6],[30.7,-81.4],[32.1,-80.9],[33.6,-79],[34.6,-77],[35.2,-75.5],[36.9,-76],[37.9,-75.9],[38.9,-74.9],[40.5,-74],[41.3,-71.9],[41.7,-70],[42.6,-70.6],[43.1,-70.7],[44,-69],[44.8,-67],[47.1,-67.8],[47.4,-69.2],[45.2,-70.9],[45,-74.9],[44.1,-76.4],[43.4,-79.2],[42.9,-78.9],[41.7,-82.4],[42.1,-83.1],[43,-82.4],[45.3,-82.5],[46.5,-84.6],[48.3,-88.3],[48,-89.6],[49.3,-94.8],[49,-95.2],[49,-123.3]];
export const DOTS=(()=>{const poly=US.map(P);const inP=(x,y)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const[xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c};let s='';for(let y=5;y<MH;y+=8.5)for(let x=5;x<MW;x+=8.5)if(inP(x,y))s+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.7"/>`;return s})();
export function ctrl(a,b){const[x1,y1]=P(a),[x2,y2]=P(b);const len=Math.hypot(x2-x1,y2-y1);return [x1,y1,(x1+x2)/2,(y1+y2)/2-Math.min(70,len*.28),x2,y2]}
export function lanePath(a,b){const[x1,y1,cx,cy,x2,y2]=ctrl(a,b);return `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
export function laneAt(a,b,t){const[x1,y1,cx,cy,x2,y2]=ctrl(a,b),u=1-t;return [u*u*x1+2*u*t*cx+t*t*x2,u*u*y1+2*u*t*cy+t*t*y2]}
export function miles(a,b){const R=3959,r=Math.PI/180,dla=(b[0]-a[0])*r,dlo=(b[1]-a[1])*r;const x=Math.sin(dla/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dlo/2)**2;return Math.round(2*R*Math.asin(Math.sqrt(x))*1.18)}
