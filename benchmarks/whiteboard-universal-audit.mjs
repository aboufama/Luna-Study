// Saved-output screenshots only. No inference, provider calls or output repairs.
import{readFile,writeFile,mkdir}from'node:fs/promises';
import{chromium}from'@playwright/test';
import{parseHtmlFormat,htmlDocument}from'./whiteboard-html.mjs';
const dir=new URL('./whiteboard-formats/',import.meta.url),report=JSON.parse(await readFile(new URL('universal-results.json',dir),'utf8'));
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:800,height:500}}),network=[],rows=[];
await page.route('**/*',r=>{network.push(r.request().url());return r.abort()});
await page.setContent('<body style="margin:0"><iframe sandbox="allow-same-origin" style="width:800px;height:500px;border:0;display:block"></iframe></body>');
await mkdir(new URL('screenshots/',dir),{recursive:true});
try{for(const record of report.runs.filter(r=>r.status==='rendered')){
 const parsed=record.format==='html'?parseHtmlFormat(record.raw):{valid:true,html:'<div id="board" data-board-root="true" style="position:relative;width:800px;height:500px">'+record.svg+'</div>'};
 if(!parsed.valid){rows.push({id:record.id,error:parsed.errors});continue}
 await page.evaluate(async html=>{const f=document.querySelector('iframe');await new Promise(resolve=>{f.onload=resolve;f.srcdoc=html});await f.contentDocument.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))},htmlDocument(parsed));
 const screenshot=`screenshots/universal-${record.id}.png`;await page.locator('iframe').screenshot({path:new URL(screenshot,dir).pathname});rows.push({id:record.id,screenshot});
}}finally{await browser.close()}
await writeFile(new URL('universal-screenshots.json',dir),JSON.stringify({providerCalls:0,network,rows},null,2)+'\n');console.log(JSON.stringify({screenshots:rows.length,providerCalls:0,network}));
