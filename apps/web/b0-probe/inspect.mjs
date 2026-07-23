import { chromium } from '/home/user/org/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
const DIST=join(process.cwd(),'dist'); const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'}
const server=createServer((req,res)=>{let p=decodeURIComponent((req.url||'/').split('?')[0]);if(p==='/')p='/index.html';const f=join(DIST,p);if(!existsSync(f)){res.statusCode=404;return res.end('nf')}res.setHeader('Content-Type',MIME[extname(f)]||'application/octet-stream');res.end(readFileSync(f))})
await new Promise(r=>server.listen(0,r)); const port=server.address().port
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const page=await browser.newPage(); await page.goto(`http://localhost:${port}/index.html`); await page.waitForFunction('window.__probeReady===true')
for(const id of ['dir','display','align']){
  const info=await page.evaluate((id)=>{const el=document.querySelector(`[data-testid="${id}"]`);return {class:el.getAttribute('class'),style:el.getAttribute('style')}},id)
  console.log(id, JSON.stringify(info))
}
await browser.close(); server.close()
