import { chromium } from '/home/user/org/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'; import { readFileSync, existsSync } from 'node:fs'; import { join, extname } from 'node:path'
const DIST=join(process.cwd(),'dist-surface'); const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer((req,res)=>{let p=decodeURIComponent((req.url||'/').split('?')[0]);if(p==='/')p='/box-variants.html';const f=join(DIST,p);if(!existsSync(f)){res.statusCode=404;return res.end('nf')}res.setHeader('Content-Type',MIME[extname(f)]||'text/plain');res.end(readFileSync(f))})
await new Promise(r=>server.listen(0,r)); const port=server.address().port
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const pg=await b.newPage({viewport:{width:1280,height:900}}); await pg.goto(`http://localhost:${port}/box-variants.html`); await pg.waitForFunction('window.__boxReady===true')
const PROPS=['display','box-sizing','white-space','flex-shrink','min-width','min-height','font-family','font-size','line-height','margin-top','padding-left','background-color']
const out=await pg.evaluate((PROPS)=>{
  const read=el=>{const cs=getComputedStyle(el);const o={};for(const p of PROPS)o[p]=cs.getPropertyValue(p).trim();return o}
  const r={}
  for(const c of document.querySelectorAll('[data-case]')){const label=c.getAttribute('data-case')
    const ref=read(c.querySelector('[data-role="ref"]').firstElementChild)
    const V=read(c.querySelector('[data-role="candV"]').firstElementChild)
    const T=read(c.querySelector('[data-role="candT"]').firstElementChild)
    r[label]={V:PROPS.filter(p=>ref[p]!==V[p]).map(p=>`${p}: ${ref[p]} vs ${V[p]}`),T:PROPS.filter(p=>ref[p]!==T[p]).map(p=>`${p}: ${ref[p]} vs ${T[p]}`)}}
  return r
},PROPS)
for(const [label,d] of Object.entries(out)){console.log(`— ${label}`);console.log('  .is_View :', d.V.length?d.V:'MATCH');console.log('  .is_Text :', d.T.length?d.T:'MATCH')}
await b.close();server.close()
