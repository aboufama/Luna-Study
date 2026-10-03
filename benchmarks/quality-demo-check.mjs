import{chromium}from'@playwright/test';
import{mkdir,writeFile}from'node:fs/promises';
import assert from'node:assert/strict';
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],calls=[],checks=[];
await mkdir('artifacts/teaching-quality',{recursive:true});
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))calls.push(r.url())});
try{
 await page.goto('http://127.0.0.1:5188/quality-demo.html');await page.getByRole('heading',{name:'Less guessing. More teaching.'}).waitFor();
 const navigation=page.getByRole('navigation',{name:'Teaching examples'}),buttons=await navigation.getByRole('button').all();
 for(const button of buttons){await button.click();await page.locator('.quality-canvas .whiteboard').waitFor();assert.equal(await page.locator('.quality-canvas button').count(),1);assert.equal(await page.locator('.quality-canvas [data-board-zone],.quality-canvas .scene-tools').count(),0);assert.equal(await page.locator('.katex-error').count(),0);checks.push({name:await button.innerText(),readonly:true,noMathErrors:true});}
 await navigation.getByRole('button',{name:'Language · clauses'}).click();await page.getByRole('button',{name:'Recovered edge case'}).click();assert.equal(await page.locator('.annotation-span').count(),4);await page.screenshot({path:'artifacts/teaching-quality/desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Close whiteboard'}).click();await page.getByRole('button',{name:'Reopen board'}).click();assert.equal(await page.locator('.annotation-span').count(),4);
 await navigation.getByRole('button',{name:'Physics · symbols'}).click();assert.ok((await page.locator('.board-matrix').innerText()).includes('gravitational acceleration'));assert.equal(await page.locator('.board-cell .board-label').filter({hasText:'gravitational acceleration'}).count(),1);
 await page.setViewportSize({width:390,height:844});await navigation.getByRole('button',{name:'Language · clauses'}).click();await page.screenshot({path:'artifacts/teaching-quality/mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);assert.deepEqual(calls,[]);
}finally{await browser.close();await writeFile('artifacts/teaching-quality/browser.json',JSON.stringify({checks,errors,providerRequests:calls,method:`${checks.length} saved example scenarios using recorded model outputs in the production readonly renderer. Real browser; no paid APIs or microphone. Desktop1440x1000/mobile390x844, nested annotations, table prose, close/reopen.`},null,2)+'\n')}
console.log(JSON.stringify({passed:checks.length,errors,providerRequests:calls.length}));
