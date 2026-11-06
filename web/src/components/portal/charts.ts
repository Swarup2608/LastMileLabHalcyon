/* eslint-disable */
// @ts-nocheck
// A donut chart as an SVG string; p is 0 to 1.
export function donut(p,size,color,label){const s=12,r=(size-s)/2,c=2*Math.PI*r;return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--raised)" stroke-width="${s}"/>${p>0?`<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${s}" stroke-linecap="round" stroke-dasharray="${(c*Math.max(0,Math.min(1,p))).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size/2} ${size/2})"/>`:''}</svg>`}
