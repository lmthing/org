import { chromium } from '/home/user/org/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'; import { readFileSync, existsSync } from 'node:fs'; import { join, extname } from 'node:path'
const DIST=join(process.cwd(),'dist-surface'); const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer((req,res)=>{let p=decodeURIComponent((req.url||'/').split('?')[0]);if(p==='/')p='/text-probe.html';const f=join(DIST,p);if(!existsSync(f)){res.statusCode=404;return res.end('nf')}res.setHeader('Content-Type',MIME[extname(f)]||'text/plain');res.end(readFileSync(f))})
await new Promise(r=>server.listen(0,r));const port=server.address().port
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const pg=await b.newPage();await pg.goto(`http://localhost:${port}/text-probe.html`);await pg.waitForFunction('window.__textReady===true')
const props=['font-family','font-size','font-weight','line-height','letter-spacing','color']
const cmp=await pg.evaluate((props)=>{
  const read=(s)=>{const cs=getComputedStyle(document.querySelector(s));const o={};for(const p of props)o[p]=cs.getPropertyValue(p).trim();return o}
  const d=(a,b)=>props.filter(p=>read(a)[p]!==read(b)[p]).map(p=>`${p}: ${read(a)[p]} vs ${read(b)[p]}`)
  return {text:d('[data-txtref]','[data-txtcand]'), view:d('[data-viewref]','[data-viewcand]')}
},props)
console.log('Text vs span:', cmp.text.length?cmp.text:'MATCH')
console.log('View vs div :', cmp.view.length?cmp.view:'MATCH')
await b.close();server.close()
