import { chromium } from '/home/user/org/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
const DIST=join(process.cwd(),'dist-surface'); const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer((req,res)=>{let p=decodeURIComponent((req.url||'/').split('?')[0]);if(p==='/')p='/theme-check.html';const f=join(DIST,p);if(!existsSync(f)){res.statusCode=404;return res.end('nf')}res.setHeader('Content-Type',MIME[extname(f)]||'text/plain');res.end(readFileSync(f))})
await new Promise(r=>server.listen(0,r));const port=server.address().port
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const pg=await b.newPage();await pg.goto(`http://localhost:${port}/theme-check.html`);await pg.waitForFunction('window.__themeCheckReady===true')
for (const theme of ['light','dark']) {
  const r = await pg.evaluate((t)=>{
    document.documentElement.setAttribute('data-theme', t)
    const inside=document.querySelector('[data-inside]')
    let bgDefs=0
    for(const ss of document.styleSheets){let rl;try{rl=ss.cssRules}catch{continue} for(const rr of rl){if(rr.cssText&&/--background\s*:/.test(rr.cssText))bgDefs++}}
    return {theme:t, insideBg: getComputedStyle(inside).backgroundColor, rootBg:getComputedStyle(document.documentElement).getPropertyValue('--background').trim(), bgDefs}
  }, theme)
  console.log(JSON.stringify(r))
}
await b.close();server.close()
