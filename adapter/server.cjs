'use strict';
// Litecoin API gateway and native explorer runtime; local mode proxies Angular.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {WebSocketServer} = require('ws');
const sharp = require('sharp');
const {providerStatus} = require('./provider-health.cjs');
const {DataStore} = require('./data-store.cjs');
const {ProviderCache} = require('./provider-cache.cjs');
const {snapshotApi} = require('./snapshot-api.cjs');
const {SharedFeed} = require('./shared-feed.cjs');
const {ObservedStats} = require('./observed-stats.cjs');
const STATIC_ROOT = process.env.LTC_STATIC_ROOT && path.resolve(process.env.LTC_STATIC_ROOT);
const ROUTER_ORIGIN = process.env.LTC_ROUTER_ORIGIN || 'http://127.0.0.1:4312';
const SITE_ORIGIN = process.env.LTC_SITE_ORIGIN || 'http://127.0.0.1:4310';
const PRIMARY = process.env.LTC_PROVIDER || 'https://litecoinspace.org';
const failedPaths = new Map();
const health = {primary: PRIMARY, lastSuccess: null, lastFailure: null, websocket: 'connecting'};
const directory = process.env.LTC_DATA_DIR || path.join(__dirname,'data');
const store = new DataStore({dir:directory});
const observedStats = new ObservedStats({directory});
function result(data, source='litecoinspace', status=200) {return {data,source,status,at:Date.now()};}
async function fetchData(url, timeout=7000, metadata=false) {
 const r=await fetch(url,{signal:AbortSignal.timeout(timeout)});
 const raw=await r.text(); let data;try {data=JSON.parse(raw);}catch {data=raw;}
 if(!r.ok) throw Object.assign(new Error(`Provider HTTP ${r.status}`),{status:r.status,retryAfter:r.headers.get('retry-after')});
 return metadata ? {data,headers:Object.fromEntries(['x-total-count','retry-after'].filter(h=>r.headers.has(h)).map(h=>[h,r.headers.get(h)]))} : data;
}
async function fallback(path) {
 if(path==='/api/blocks/tip/height' || path==='/api/blocks/tip/hash') {
  const d=await fetchData('https://api.blockcypher.com/v1/ltc/main',4000);
  return result(path.endsWith('height')?String(d.height):d.hash,'blockcypher');
 }
 const m=path.match(/^\/api\/(?:v1\/)?block(?:-height)?\/([a-f0-9]{64}|\d+)$/);
 if(m) {
  const b=await fetchData('https://api.blockcypher.com/v1/ltc/main/blocks/'+m[1]+'?txstart=1&limit=1',4000);
  if(path.includes('block-height')) return result(b.hash,'blockcypher');
  // BlockCypher does not supply weight or all fees; don't fabricate an extended block.
  throw new Error('Extended block unavailable from fallback');
 }
 throw new Error('No independent equivalent for this capability');
}
function positiveSetting(name, defaultValue) {
 const value=Number(process.env[name]);return Number.isFinite(value)&&value>0?Math.floor(value):defaultValue;
}
const provider = new ProviderCache({primary:PRIMARY,fallback,health,failedPaths,store,
 maxRequests:positiveSetting('LTC_REST_REQUESTS_PER_MINUTE',60)});
const api = requestPath => {
 const live = snapshotApi(sharedFeed, requestPath);
 if (live) { failedPaths.delete(requestPath); return Promise.resolve(live); }
 return provider.get(requestPath);
};
const sharedFeed = new SharedFeed({url:PRIMARY.replace(/^http/,'ws')+'/api/v1/ws',health,store,
 observe:message=>observedStats.observe(message),maxDetails:positiveSetting('LTC_MAX_DETAIL_FEEDS',8)});
let localHistoryUsed = false;
let coverageCache = null, coverageAt = 0;
function coverage() {
 if (!coverageCache || Date.now()-coverageAt>30000) {coverageCache=observedStats.summary();coverageAt=Date.now();}
 return coverageCache;
}
function currentHealth() {
 const status=providerStatus(health,failedPaths);
 const feed=sharedFeed.freshness();
 return {...status,feed,stale:status.stale||feed.state!=='live',cacheEntries:provider.cache.size,
  sharedClients:sharedFeed.clients.size,detailFeeds:sharedFeed.details.size,localHistory:localHistoryUsed?coverage().coverage.native:null};
}
function send(res,status,data,type='application/json',headers={}) {
 res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',...headers});res.end(typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data));
}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function metadata(path) {
 const m=path.match(/^\/(tx|block|address)\/([A-Za-z0-9]+)$/);
 let cardDescription='Entity data temporarily unavailable. Please retry.';
 let title='ltc.tx.taxi - Litecoin Explorer', description='Explore Litecoin blocks, transactions, addresses, fees and mining activity.';
 if(m) {
  const kind=m[1],id=m[2];title=`Litecoin ${kind} ${id} - ltc.tx.taxi`;
  let p=kind==='block'?'/api/v1/block/'+id:'/api/'+kind+'/'+id;
  if(kind==='block' && /^\d+$/.test(id)) {const h=await api('/api/block-height/'+id);if(h.status===200)p='/api/v1/block/'+h.data;}
  const r=await api(p);
  if(r.status===200) {
   if(kind==='tx')description=`${r.data.status?.confirmed?'Confirmed':'Pending'} Litecoin transaction. Fee: ${(r.data.fee/1e8).toFixed(8)} LTC. Transparent outputs; MWEB amounts remain private.`;
   if(kind==='block')description=`Litecoin block ${r.data.height}. ${r.data.tx_count} transactions. Mined ${new Date(r.data.timestamp*1000).toISOString()}.`;
   if(kind==='address')description=`Litecoin address with ${r.data.chain_stats?.tx_count ?? 'indexed'} confirmed transactions. Transparent-chain history.`;
   if(kind==='tx')cardDescription=`${r.data.status?.confirmed?'Confirmed':'Pending'} transaction · Fee: ${(r.data.fee/1e8).toFixed(8)} LTC`;
   if(kind==='block')cardDescription=`Block ${r.data.height} · ${r.data.tx_count} transaction${r.data.tx_count===1?'':'s'} · ${new Date(r.data.timestamp*1000).toISOString().slice(0,10)}`;
   if(kind==='address')cardDescription=`${r.data.chain_stats?.tx_count ?? 'Indexed'} confirmed transaction${r.data.chain_stats?.tx_count===1?'':'s'}`;
  } else description='Litecoin entity data is temporarily unavailable. Retry to retrieve current details.';
 }
 return {title,description,cardDescription,path:m?path:'/'};
}
const cardTemplate=fs.readFileSync(__dirname+'/assets/social-card.svg','utf8');
const cardLogo='data:image/svg+xml;base64,'+fs.readFileSync(__dirname+'/../frontend/src/resources/branding/ltc-dark-navbar.svg').toString('base64');
async function card(path) {
 const m=await metadata(path), entity=m.path.match(/^\/(tx|block|address)\/([A-Za-z0-9]+)$/);
 const headline=entity?({tx:'transaction',block:'block',address:'address'}[entity[1]]):'explorer';
 const subtitle=entity?m.cardDescription:'Live Litecoin blocks, transactions, fees and mining.';
 const bounded=subtitle.length>61?subtitle.slice(0,60).trimEnd()+'…':subtitle;
 const identifier=entity?`<text x="80" y="548" fill="#747474" font-family="DejaVu Sans Mono, monospace" font-size="18">${escape(entity[2])}</text>`:'';
 const values={headline:escape(headline),subtitle:escape(bounded),logo:cardLogo,identifier};
 const svg=cardTemplate.replace(/\{\{(headline|subtitle|logo|identifier)\}\}/g,(_,key)=>values[key]);
 return sharp(Buffer.from(svg)).png().toBuffer();
}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 try {
  if(req.method!=='GET' && req.method!=='HEAD')return send(res,405,{error:'Read-only local explorer'});
  if(u.pathname.startsWith('/local-router/')) {
   const path=u.pathname.slice('/local-router'.length)+u.search;
   if(!/^\/(api|assets)\//.test(path)) {res.writeHead(302,{location:ROUTER_ORIGIN+path});return res.end();}
   const r=await fetch(ROUTER_ORIGIN+path,{signal:AbortSignal.timeout(12000),redirect:'manual'});
   if(r.status>=300&&r.status<400) { const dest=r.headers.get('location');res.writeHead(r.status,{location:dest});return res.end(); }
   return send(res,r.status,Buffer.from(await r.arrayBuffer()),r.headers.get('content-type')||'application/json');
  }
  if(u.pathname==='/api/provider-health') {
   // An idle gateway has no observations, not evidence of an upstream outage.
   // Probe current mempool data before reporting stale health to a visitor.
   if(!health.lastSuccess || Date.now()-health.lastSuccess>30000)await api('/api/mempool');
   return send(res,200,currentHealth());
  }
  if(u.pathname==='/healthz')return send(res,200,currentHealth());
  if(u.pathname==='/api/local-statistics/coverage')return send(res,200,coverage());
  if(u.pathname==='/api/local-statistics/series')return send(res,200,observedStats.series());
  if(u.pathname==='/api/local-resolve') {
   try {return send(res,200,await fetchData(ROUTER_ORIGIN+'/api/v1/resolve?value='+encodeURIComponent(u.searchParams.get('value')||''),12000));} catch {return send(res,503,{unavailable:true});}
  }
  if(u.pathname.startsWith('/api/')) {
   const r=await api(u.pathname+u.search);
   if(u.pathname==='/api/v1/statistics/2h') {
    const samples=observedStats.nativeSeries(2*3600000);
    // Keep upstream history when available. Only real locally observed chart
    // samples can fill an outage; never synthesize fee buckets or old history.
    if((r.status!==200 || r.stale) && samples.length) {
     localHistoryUsed=true;
     return send(res,200,samples,'application/json',{'X-LTC-Source':'local-observations',
      'X-LTC-Coverage':'observed-only','X-LTC-Stale':String(sharedFeed.freshness().state!=='live'),
      'X-LTC-Observed-At':String(coverage().coverage.native.end)});
    }
    if(r.status===200&&!r.stale)localHistoryUsed=false;
   }
   return send(res,r.status,r.data,typeof r.data==='string'?'text/plain':'application/json',{...r.headers,'X-LTC-Source':r.source,'X-LTC-Stale':String(!!r.stale),'X-LTC-Observed-At':String(r.at)});
  }
  if(u.pathname.startsWith('/resources/mining-pools/')) {
   const r=await fetch(PRIMARY+u.pathname,{signal:AbortSignal.timeout(5000)});return send(res,r.status,Buffer.from(await r.arrayBuffer()),r.headers.get('content-type')||'image/svg+xml');
  }
  if(u.pathname==='/og.png') return send(res,200,await card(u.searchParams.get('path')||'/'),'image/png');
  if(u.pathname.startsWith('/source/')||u.pathname.endsWith('.map'))return send(res,404,{error:'Not found'});
  let r;
  if(STATIC_ROOT) {
   const relative=decodeURIComponent(u.pathname).replace(/^\/+/, '');
   let file=path.resolve(STATIC_ROOT,relative);
   if(file!==STATIC_ROOT&&!file.startsWith(STATIC_ROOT+path.sep))return send(res,404,{error:'Not found'});
   if(!path.extname(relative))file=path.join(STATIC_ROOT,'index.html');
   let bytes;try{bytes=await fs.promises.readFile(file);}catch{return send(res,404,{error:'Not found'});}
   const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.webmanifest':'application/manifest+json','.txt':'text/plain','.wasm':'application/wasm'};
   r=new Response(bytes,{headers:{'content-type':types[path.extname(file)]||'application/octet-stream'}});
  } else r=await fetch('http://127.0.0.1:4311'+req.url,{headers:{accept:req.headers.accept||'*/*'},signal:AbortSignal.timeout(15000)});
  const type=r.headers.get('content-type')||'text/plain';
  if(type.includes('text/html')) {
   let html=await r.text();const m=await metadata(u.pathname),origin=SITE_ORIGIN;
   html=html.replace(/<title>[\s\S]*?<\/title>/,'').replace(/<meta[^>]+(?:name|property)=["'](?:description|og:[^"']+|twitter:[^"']+)["'][^>]*>/g,'').replace(/<link[^>]+rel=["']canonical["'][^>]*>/g,'');
   html=html.replace('</head>',`<title>${escape(m.title)}</title><meta name="description" content="${escape(m.description)}"><link id="canonical" rel="canonical" href="https://ltc.tx.taxi${escape(m.path)}"><meta property="og:title" content="${escape(m.title)}"><meta property="og:description" content="${escape(m.description)}"><meta property="og:type" content="website"><meta property="og:site_name" content="ltc.tx.taxi"><meta property="og:locale" content="en_US"><meta property="og:image" content="${origin}/og.png?v=4&amp;path=${encodeURIComponent(m.path)}"><meta property="og:url" content="https://ltc.tx.taxi${escape(m.path)}"><meta property="og:image:type" content="image/png"><meta property="og:image:alt" content="${escape(m.title)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:domain" content="ltc.tx.taxi"><meta name="twitter:image:alt" content="${escape(m.title)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(m.title)}"><meta name="twitter:description" content="${escape(m.description)}"><meta name="twitter:image" content="${origin}/og.png?v=4&amp;path=${encodeURIComponent(m.path)}"></head>`);
   return send(res,r.status,html,type);
  }
  return send(res,r.status,Buffer.from(await r.arrayBuffer()),type);
 }catch(e){send(res,503,{error:'Local service unavailable',message:e.message});}
});
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{
 if(req.url==='/api/v1/ws')wss.handleUpgrade(req,socket,head,client=>wss.emit('connection',client));
 else {
  if(STATIC_ROOT){socket.destroy();return;}
  // Preserve Angular incremental rebuild notifications.
  const upstream=http.request({host:'127.0.0.1',port:4311,path:req.url,headers:req.headers});
  upstream.on('upgrade',(r,s,h)=>{socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(r.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');if(h.length)socket.write(h);if(head.length)s.write(head);s.pipe(socket).pipe(s);});upstream.on('error',()=>socket.destroy());upstream.end();
 }
});
wss.on('connection',client=>sharedFeed.attach(client));
server.listen(Number(process.env.PORT||9332),process.env.LTC_HOST||'127.0.0.1',()=>console.log('LTC adapter on 127.0.0.1:'+ (process.env.PORT||9332)));
// Separate public local review port; same handler includes initial metadata.
if(!process.env.PORT)http.createServer(server.listeners('request')[0]).on('upgrade',server.listeners('upgrade')[0]).listen(4310,'127.0.0.1');
function shutdown() {
 sharedFeed.close();provider.close();observedStats.close();store.close();
 server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();
}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
