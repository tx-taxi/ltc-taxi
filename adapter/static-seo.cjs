'use strict';
// Static content is generated from the existing Angular documents during the build.
const data = require('./static-seo-pages.json');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const origin = `https://${data.host}`;
const pages = new Map(data.pages.map(page => [page.path, page]));
function normalize(pathname) {
  try { return decodeURIComponent(pathname).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'; }
  catch { return pathname; }
}
function page(pathname) {
  const route = normalize(pathname);
  if (pages.has(route)) return pages.get(route);
  const numbered = route.match(/^\/blocks\/([1-9][0-9]*)$/);
  if (numbered) return {...pages.get('/blocks/1'), path: route, title: `${data.chain} blocks, page ${numbered[1]} - ${data.host}`};
  const projected = route.match(/^\/mempool-block\/([0-9]+)$/);
  if (projected) return {...pages.get('/mempool-block/0'), path: route, title: `${data.chain} pending sample ${projected[1]} - ${data.host}`};
  if (data.poolPages && /^\/mining\/pool\/[^/]+$/.test(route)) return {...pages.get('/graphs/mining/pools'), path: route, title: `${data.chain} mining pool ${route.split('/').at(-1)} - ${data.host}`};
  return null;
}
function entity(pathname) {
  const route = normalize(pathname);
  return /^\/tx\/[a-f0-9]{64}$/i.test(route) || /^\/block\/(?:[0-9]+|[a-f0-9]{64})$/i.test(route) || /^\/address\/[A-Za-z0-9:]{25,120}$/.test(route);
}
function nonIndexable(pathname) {
  const route = normalize(pathname);
  if (page(route) || entity(route)) return false;
  return !/\.[a-z0-9]+$/i.test(route);
}
function redirect(pathname) {
  const route = normalize(pathname);
  if (data.aliases[route]) return data.aliases[route];
  if (data.poolRedirect && /^\/mining\/pool\/[^/]+$/.test(route)) return data.poolRedirect;
  if (data.graphFallback && route.startsWith('/graphs/') && !page(route)) return data.graphFallback;
  if (pages.has(route) && pathname !== route) return route;
  return null;
}
function existingNonIndexable(pathname) {
  const route = normalize(pathname);
  // Preserve registered presentation routes while keeping them out of discovery XML.
  const presentation = /^\/clock(?:\/[^/]+(?:\/[^/]+)?)?$/.test(route)
    || /^\/view\/(?:blocks|block\/[^/]+|mempool-block\/[^/]+)$/.test(route)
    || /^\/cab\/[^/]+\/[^/]+\/[^/]+$/.test(route)
    || route === '/widget/wallet'
    || /^\/preview(?:\/(?:testnet|testnet4|signet|regtest))?(?:\/(?:block|address|wallet|tx)\/[^/]+|\/mining\/pool\/[^/]+|\/lightning(?:\/[^/]+)*)?$/.test(route);
  return data.noindexRoutes.includes(route) || presentation || (!data.poolPages && /^\/mining\/pool\/[^/]+$/.test(route));
}
function markdownPath(route) { return route === '/' ? '/index.md' : `${route}.md`; }
function endpoint(pathname) {
  if (pathname === '/llm.txt') return {status: 308, headers: {Location: `${origin}/llms.txt`}, body: ''};
  if (pathname === '/sitemap.xml') return {type: 'application/xml; charset=utf-8', body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${data.pages.map(item => `  <url><loc>${escape(origin + item.path)}</loc></url>`).join('\n')}\n</urlset>\n`};
  if (pathname === '/robots.txt') return {type: 'text/plain; charset=utf-8', body: `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`};
  if (pathname === '/llms.txt') return {type: 'text/plain; charset=utf-8', body: data.llms};
  if (pathname === '/llms-full.txt') return {type: 'text/plain; charset=utf-8', headers: {'X-Robots-Tag': 'noindex, follow'}, body: data.llmsFull};
  const item = pathname === '/index.md' ? pages.get('/') : pathname.endsWith('.md') ? pages.get(pathname.slice(0, -3)) : null;
  if (item) return {type: 'text/markdown; charset=utf-8', headers: {Link: `<${origin + item.path}>; rel="canonical"`, 'X-Robots-Tag': 'noindex, follow'}, body: item.markdown};
  return null;
}
function headLinks(item) {
  return `<link rel="describedby" type="text/plain" href="${origin}/llms.txt">${item && pages.has(item.path) ? `<link rel="alternate" type="text/markdown" href="${origin + markdownPath(item.path)}">` : ''}`;
}
function render(html, item) {
  if (!item) return html;
  // Angular replaces the same root during bootstrap; no second UI or bot-only response.
  const links = data.pages.filter(p => p.path !== '/').map(p => `<a href="${escape(p.path)}">${escape(p.label)}</a>`).join(' · ');
  const content = `<div class="container-xl"><main><h1>${escape(item.label)}</h1>${item.html}<nav aria-label="Explorer pages">${links}</nav></main></div>`;
  return html.replace(/(<app-root\b[^>]*>)[\s\S]*?(<\/app-root>)/i, (_, open, close) => open + content + close);
}
module.exports = {data, page, normalize, entity, nonIndexable, existingNonIndexable, redirect, endpoint, headLinks, render};
