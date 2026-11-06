/* eslint-disable */
// @ts-nocheck
// Percentages for the portal's tables and reports.

export const pct=(a,b)=>b?((a/b)*100).toFixed(1)+'%':'–';
export const pctOf=(n,of)=>of?Math.round(n/of*1000)/10+'%':'–';
