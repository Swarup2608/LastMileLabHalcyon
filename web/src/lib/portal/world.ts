/* eslint-disable */
// @ts-nocheck
// The simulated world (Halcyon brief: 280 clients, 5 warehouses, 6 carriers; 12 shown): fixed lanes, carriers and
// addresses, plus createWorld() for the warehouses, clients and products the database supplies.
export const SHEET={West:'A',Midwest:'D',Southeast:'D',South:'C',Northeast:'F'};
export const ENGINE={West:'A',Midwest:'B',Southeast:'E',South:'C',Northeast:'F'};
export const CARRIERS=['A','B','C','D','E','F'];
const CONTACTS=['Priya Raman','Daniel Osei','Marisol Vega','Tom Pellham','Aisha Bello','Grace Lindqvist','Kenji Morita','Chidi Okafor','Luis Ferreira','Hannah Weiss','Owen Fenwick','Nadia Haddad'];
const COLORS=['#1D6FD1','#0E8A8A','#4357C9','#B26A00','#1E7F4A','#6B5BA8','#B4322B','#0B6E77','#4A6FA5','#9A5B00','#2F7D4A','#5B6878'];
const CHANNEL={Email:'email',EDI:'edi',API:'api'};
export const DEST=[
 {street:'418 Alder St',unit:'Suite 210',city:'Eugene',st:'OR',zip:'97401',region:'West'},
 {street:'2210 Larimer St',unit:'Dock 3',city:'Denver',st:'CO',zip:'80205',region:'West'},
 {street:'77 Canal St NW',unit:'Floor 4',city:'Grand Rapids',st:'MI',zip:'49503',region:'Midwest'},
 {street:'1350 N Wells St',unit:'Suite 120',city:'Chicago',st:'IL',zip:'60610',region:'Midwest'},
 {street:'905 Main St',unit:'Unit B',city:'Kansas City',st:'MO',zip:'64105',region:'Midwest'},
 {street:'64 Peachtree Pl NE',unit:'Suite 400',city:'Atlanta',st:'GA',zip:'30309',region:'Southeast'},
 {street:'3120 N Boulevard',unit:'Dock 2',city:'Tampa',st:'FL',zip:'33603',region:'Southeast'},
 {street:'510 Gervais St',unit:'Suite 150',city:'Columbia',st:'SC',zip:'29201',region:'Southeast'},
 {street:'2401 Elm St',unit:'Unit 6',city:'Dallas',st:'TX',zip:'75226',region:'South'},
 {street:'880 Congress Ave',unit:'Suite 300',city:'Austin',st:'TX',zip:'78701',region:'South'},
 {street:'45 Commercial St',unit:'Floor 2',city:'Portland',st:'ME',zip:'04101',region:'Northeast'},
 {street:'1200 Arch St',unit:'Suite 900',city:'Philadelphia',st:'PA',zip:'19107',region:'Northeast'},
];
export const BOOK=[{label:'Eugene shop',d:0},{label:'Chicago store',d:3},{label:'Atlanta store',d:5},{label:'Dallas warehouse',d:8},{label:'Philadelphia store',d:11}];
export const HUBS=['Memphis','Louisville','Indianapolis','Harrisburg','Fort Worth','Salt Lake City'];

export function createWorld(network,user){
// Warehouses come from the database; their names are already short ("Midwest 1"), so name and city label match.
const WHS=network.warehouses;
const WH_OF=network.homeOf;
const whName=id=>(WHS.find(w=>w.id===id)||{}).name||id;
const whCity=whName;
// Products and their stock come from the database. The simulated clients are the companies that own those products,
// plus the signed-in client's; the dataset has no contacts or brand colours for them, so those are drawn from pools.
const CLIENTS=[],CI={};
const addClient=(id,name,channel)=>{
  if(CI[id]==null){const i=CLIENTS.length;CI[id]=i;name=name||id;
    CLIENTS.push({id,name,contact:CONTACTS[i%CONTACTS.length],domain:name.toLowerCase().replace(/[^a-z0-9]+/g,'')+'.com',ch:CHANNEL[channel]||'email',color:COLORS[i%COLORS.length]})}
  return CI[id];
};
// stock: cartons available (on hand less reserved) in every warehouse, 0 where the product isn't carried;
// reorder: the reorder point in each warehouse that carries it.
const PRODUCTS=network.products.map(p=>{
  const stock={},reorder={};for(const w of WHS)stock[w.id]=0;
  for(const x of p.stock)if(x.warehouseId in stock){stock[x.warehouseId]=x.available;reorder[x.warehouseId]=x.reorderPoint}
  // demand: what the simulation has seen at each warehouse, for the allocation agent.
  return {id:p.productId,demand:{},sku:p.sku,name:p.productName,client:addClient(p.clientId,p.clientName,p.primaryOrderChannel),stock,reorder};
});
// Every client so far owns a product, so these are the ones the simulation draws incoming orders from.
const SELLERS=CLIENTS.map((_,i)=>i);
const myClient=user.role==='client'?addClient(user.clientId||'',user.company):-1;
const carries=(p,w)=>w in p.reorder;
const lowAt=(p,w)=>carries(p,w)&&p.stock[w]<=p.reorder[w];
const lowAny=p=>WHS.some(w=>lowAt(p,w.id));
return {WHS,WH_OF,whName,whCity,CLIENTS,PRODUCTS,SELLERS,myClient,carries,lowAt,lowAny};
}
