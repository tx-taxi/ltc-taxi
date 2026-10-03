'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const frontend = path.resolve(process.argv[2] || path.join(__dirname, '../frontend'));
const output = path.resolve(process.argv[3] || path.join(__dirname, 'static-seo-pages.json'));
const config = require('./static-seo.config.json');
const origin = `https://${config.host}`;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sources = new Set();
function read(file) {sources.add(file); return fs.readFileSync(path.join(frontend, file), 'utf8');}
const introSource = read('src/app/shared/components/tx-taxi-docs-intro/tx-taxi-docs-intro.component.html');
function sanitize(source) {
  return source
    .replace(/<app-tx-taxi-docs-intro\b[^>]*>[\s\S]*?<\/app-tx-taxi-docs-intro>/g, introSource.replace(/\{\{\s*chainName\s*\}\}/g, config.chain).replace(/\{\{\s*chainHost\s*\}\}/g, config.host).replace(/\{\{\s*context\s*\}\}/g, 'documentation'))
    .replace(/\s+routerLink="([^"]+)"/g, ' href="$1"')
    .replace(/\s+(?:\*[^\s=]+|\[[^\]]+\]|\([^\)]+\)|#[^\s=]+)(?:=(?:"[^"]*"|'[^']*'))?/g, '')
    .replace(/\s+(?:i18n(?:-[\w-]+)?|ngb\w+|routerLinkActive)(?:="[^"]*")?/g, '')
    .replace(/\{\{[\s\S]*?\}\}/g, '')
    .replace(/<\/?(?:ng-container|ng-template|app-[\w-]+|fa-icon)\b[^>]*>/g, '')
    .replace(/<\/?main\b/g, tag => tag.replace('main', 'section'))
    .replace(/<\/?h1\b/g, tag => tag.replace('h1', 'h2'))
    .replace(/<p>EOF<\/p>/g, '')
    .trim();
}
function markdown(html) {
  return html
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g, (_, code) => `\n\n\`\`\`\n${code.replace(/<[^>]+>/g, '')}\n\`\`\`\n\n`)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g, (_, level, text) => `\n\n${'#'.repeat(Number(level))} ${text}\n\n`)
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, text) => `[${text}](${href.startsWith('/') ? origin + href : href})`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/g, (_, text) => '`' + text + '`')
    .replace(/<li\b[^>]*>/g, '\n- ').replace(/<\/(?:p|div|section|article|ul|ol|table|tr)>/g, '\n\n')
    .replace(/<br\s*\/?\s*>/g, '\n').replace(/<\/(?:th|td)>/g, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
let docs;
if (config.docsData) {
  const source = stripTypeScriptTypes(read(config.docsData), {mode: 'strip'}).replace(/\bexport\s+/g, '');
  docs = JSON.parse(vm.runInNewContext(source + `\nJSON.stringify({faq:${config.docsExports.faq},rest:${config.docsExports.rest},ws:${config.docsExports.ws}})`, {}, {timeout: 1000}));
}
const apiTemplate = config.docsData ? read('src/app/docs/api-docs/api-docs.component.html') : '';
function documentBody(kind) {
  if (!config.docsData) {
    const source = read('src/app/docs/docs/docs.component.html');
    const tab = {faq:'guide',rest:'rest',ws:'websocket'}[kind];
    const match = source.match(new RegExp(`<main[^>]*\\*ngIf="activeTab === '${tab}'"[^>]*>([\\s\\S]*?)<\\/main>`));
    if (!match) throw Error(`Missing actual ${tab} document content`);
    return sanitize(match[1]);
  }
  const connection = kind === 'ws' ? `<p>WebSocket endpoint: <code>wss://${config.host}/api/v1/ws</code></p>` : '';
  return connection + docs[kind].map(item => {
    if (item.type === 'category') return `<h2 id="${escape(item.fragment)}">${escape(item.title)}</h2>`;
    let description = typeof item.description === 'string' ? item.description : item.description?.default || '';
    if (kind === 'faq' && !description) {
      const match = apiTemplate.match(new RegExp(`<ng-template\\s+type="${item.fragment}">([\\s\\S]*?)<\\/ng-template>`));
      if (!match) throw Error(`Missing FAQ body: ${item.fragment}`);
      description = match[1];
    }
    const endpointPath = item.path || (item.urlString ? '/api' + item.urlString : '');
    const request = item.request || (endpointPath ? `curl ${origin}${endpointPath}` : item.payload || '');
    const response = item.response || item.codeExample?.default?.codeSampleMainnet?.response || '';
    return `<article id="${escape(item.fragment)}"><h3>${escape(item.title)}</h3>${endpointPath ? `<p><code>${escape(item.method || item.httpRequestMethod || 'GET')} ${escape(endpointPath)}</code></p>` : ''}${description && !description.includes('<') ? `<p>${escape(description)}</p>` : description}${request ? `<pre><code>${escape(request)}</code></pre>` : ''}${response ? `<p>Example response</p><pre><code>${escape(response)}</code></pre>` : ''}</article>`;
  }).join('\n');
}
const about = sanitize(read('src/app/components/about/about.component.html'));
const aboutParagraphs = about.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) || [];
const pages = config.routes.map(route => {
  if (route.source) read(route.source);
  let html;
  if (route.kind === 'document') html = sanitize(read(route.source));
  else if (route.kind.startsWith('docs-')) html = documentBody(route.kind.slice(5));
  else if (route.kind === 'home') html = `<p>${escape(route.description)}</p>${aboutParagraphs.slice(0, 3).join('\n')}`;
  else html = `<p>${escape(route.description)}</p>${route.context ? `<p>${escape(route.context)}</p>` : ''}`;
  const title = route.path === '/' ? `${config.host} - ${config.chain} Explorer` : `${route.label} - ${config.host}`;
  return {path:route.path,label:route.label,title,description:route.description,kind:route.kind,html,markdown:`# ${route.label}\n\nCanonical: ${origin}${route.path}\n\n${markdown(html)}\n`,source:route.source || config.docsData || 'src/app/docs/docs/docs.component.html'};
});
const llms = `# ${config.host}\n\n> ${config.description}\n\n## Documentation and explorer pages\n\n${pages.map(page => `- [${page.label}](${origin + page.path}): ${page.description}\n  - [Markdown](${origin + (page.path === '/' ? '/index.md' : page.path + '.md')})`).join('\n')}\n\n## Machine-readable resources\n\n- [Full documentation](${origin}/llms-full.txt)\n- [Sitemap](${origin}/sitemap.xml)\n\n## Coverage\n\n${config.coverage}\n`;
const llmsFull = pages.filter(page => ['document','docs-faq','docs-rest','docs-ws'].includes(page.kind)).map(page => page.markdown).join('\n---\n\n');
fs.writeFileSync(output, JSON.stringify({...config,pages,llms,llmsFull,sourceFiles:[...sources].sort()}, null, 2) + '\n');
const metadata = Object.fromEntries(pages.map(page => [page.path,{title:page.title,description:page.description}]));
fs.writeFileSync(path.join(frontend,'src/app/shared/native-seo-pages.ts'), `// Generated from existing native explorer pages; regenerate with adapter/generate-static-seo.cjs.\nexport const nativeSeoPages: Record<string, {title: string; description: string}> = ${JSON.stringify(metadata,null,2)};\nexport const nativeSeoScreenshot = ${JSON.stringify(config.socialScreenshot,null,2)};\n`);
console.log(`Generated ${pages.length} canonical ${config.chain} pages from ${sources.size} content files.`);
