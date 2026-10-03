import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { parseHtmlFormat, htmlDocument, htmlFormatPrompt } from '../benchmarks/whiteboard-html.mjs';

const board=(content,attrs='')=>`<div id="board" data-board-root="true" style="position:relative;width:800px;height:500px" ${attrs}>${content}</div>`;
const grid=()=>board(`<style>.grid { display:grid; grid-template-columns:repeat(10, 60px); grid-template-rows:repeat(8, 40px); position:absolute;left:80px;top:80px } .cell { border:1px solid #243544; background:white }</style><div id="matrix" class="grid">${Array.from({length:80},(_,i)=>`<div id="matrix-cell-${Math.floor(i/10)}-${i%10}" class="cell" data-selectable="matrix-cell-${Math.floor(i/10)}-${i%10}"></div>`).join('')}</div>`);

test('static HTML grid preserves complete blank cells and emits explicit nonvoid closing tags',()=>{
 const parsed=parseHtmlFormat(grid()); assert.equal(parsed.valid,true,parsed.errors.join());
 assert.equal(parsed.stats.matrices[0].rows,8);assert.equal(parsed.stats.matrices[0].cols,10);assert.equal(parsed.stats.matrices[0].completeGrid,true);assert.equal(parsed.stats.matrices[0].indexedCells,80);
 assert.equal(parsed.stats.matrices[0].values.flat().every(x=>x===''),true);
 assert.match(parsed.html,/<div id="matrix-cell-0-0"[^>]*><\/div>/);assert.doesNotMatch(parsed.html,/<div[^>]*\/>/);
 assert.match(htmlDocument(parsed),/script-src 'none'/);assert.match(htmlFormatPrompt,/complete scene/);
});
test('HTML text escapes remain text and table cells retain public payoffs',()=>{
 const p=parseHtmlFormat(board('<table id="payoffs"><tbody><tr><td id="matrix-cell-0-0">7,7,0</td><td id="matrix-cell-0-1">1,6,1</td></tr><tr><td id="matrix-cell-1-0">6,1,1</td><td id="matrix-cell-1-1">0,0,1</td></tr></tbody></table><span id="literal">&lt;script&gt; &amp; value</span>'));
 assert.equal(p.valid,true,p.errors.join());assert.deepEqual(p.stats.matrices[0].values,[['7,7,0','1,6,1'],['6,1,1','0,0,1']]);assert.ok(p.stats.texts.includes('<script> & value'));assert.match(p.html,/&lt;script&gt;/);
});
test('full HTML replacement preserves IDs and reports explicit removed identities',()=>{
 const initial=parseHtmlFormat(board('<div id="axis" style="position:absolute;left:80px;top:250px;width:640px;border-top:2px solid black"></div><span id="A" style="position:absolute;left:208px;top:250px">A 0.2</span><span id="B">B 0.8</span>'));
 const updated=parseHtmlFormat(board('<div id="axis" style="position:absolute;left:80px;top:250px;width:640px;border-top:2px solid black"></div><span id="A" style="position:absolute;left:272px;top:250px">A 0.3</span><span id="B">B 0.8</span>'),{previous:initial});
 assert.equal(updated.valid,true);assert.deepEqual(updated.stats.retainedIds,['board','axis','A','B']);assert.deepEqual(updated.stats.removedIds,[]);
 const missing=parseHtmlFormat(board('<span id="A">A</span>'),{previous:initial.scene});assert.deepEqual(missing.stats.removedIds,['axis','B']);
});
test('HTML rejects active elements, network attributes, XML entities and malformed documents',()=>{
 for(const inner of ['<script>alert(1)</script>','<svg></svg>','<canvas></canvas>','<iframe></iframe>','<img src="https://example.invalid/a"/>','<form></form>','<div onclick="alert(1)">bad</div>','<div xmlns="http://www.w3.org/2000/svg"></div>','<div id="same"></div><div id="same"></div>','<div><span></div>','<!-- comment -->','<div data-selectable="guessed" id="real"></div>']) assert.equal(parseHtmlFormat(board(inner)).valid,false,inner);
 for(const raw of ['<!DOCTYPE div [<!ENTITY leak SYSTEM "file:///etc/passwd">]>'+board('&leak;'),board('')+board(''),'<div id="board" data-board-root="true">x</div>']) assert.equal(parseHtmlFormat(raw).valid,false);
 assert.throws(()=>htmlDocument({valid:false,html:'<script/>'}));
});
test('PostCSS allowlist rejects CSS imports, escaped payloads, external URLs, pseudos and arbitrary declarations',()=>{
 for(const css of ['@import "https://example.invalid";','.x{background:url(https://example.invalid/a)}','.x{background:u\\72l(https://example.invalid/a)}','.x{--a:red}', '.x{color:var(--a)}','.x{width:calc(1px + 2px)}','.x{position:fixed}', '.x{animation:spin 1s}', '.x{behavior:expression(alert(1))}', '.x::before{content:"x"}', '[id]{color:red}', '.x{pointer-events:none}', '.x{display:none}', '.x{color:red!important}', '.x{grid-template-columns:repeat(999999,1px)}', '.x{color:red}.x{background-image:linear-gradient(red,blue)}']) assert.equal(parseHtmlFormat(board(`<style>${css}</style><div class="x"></div>`)).valid,false,css);
 const p=parseHtmlFormat(board('<style>div.node, #arrow > span { position:absolute; color:rgb(20,30,40); transform:translate(10px, 20px) rotate(30deg); border:2px solid #333; }</style><div class="node" id="arrow"><span>safe</span></div>'));assert.equal(p.valid,true,p.errors.join());
});
test('HTML matrix metadata does not invent missing cells',()=>{
 const p=parseHtmlFormat(board('<div id="matrix-cell-0-0"></div><div id="matrix-cell-7-9"></div>'));
 assert.equal(p.valid,true);assert.equal(p.stats.matrices[0].completeGrid,false);assert.equal(p.stats.matrices[0].indexedCells,2);
});
test('sandbox HTML has actual 8x10 cell boxes and full-cell hit targets with zero requests',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage(),requests=[];await page.route('**/*',r=>{requests.push(r.request().url());r.abort();});
  await page.setContent('<iframe id="frame" sandbox="allow-same-origin" style="width:800px;height:500px;border:0"></iframe>');
  const parsed=parseHtmlFormat(grid());await page.evaluate(doc=>{document.querySelector('iframe').srcdoc=doc;},htmlDocument(parsed));
  const frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForSelector('#matrix-cell-7-9');
  const result=await frame.evaluate(()=>{
   const cells=[...document.querySelectorAll('[data-selectable]')],boxes=cells.map(el=>{const b=el.getBoundingClientRect();return {id:el.id,x:b.x,y:b.y,width:b.width,height:b.height};});
   const hitAreas=boxes.every(b=>[[.5,.5],[.1,.1],[.9,.9]].every(([u,v])=>document.elementFromPoint(b.x+b.width*u,b.y+b.height*v)?.closest('[data-selectable]')?.id===b.id));
   return {count:cells.length,rows:new Set(boxes.map(b=>b.y)).size,cols:new Set(boxes.map(b=>b.x)).size,hitAreas,allBlank:cells.every(c=>!c.textContent.trim()),last:boxes.at(-1)};
  });
  assert.deepEqual({...result,last:undefined},{count:80,rows:8,cols:10,hitAreas:true,allBlank:true,last:undefined});assert.equal(result.last.width,60);assert.equal(result.last.height,40);assert.deepEqual(requests,[]);
 }finally{await browser.close();}
});

// Inert table/rich-text tags are part of the refined benchmark contract.
test('supports native table column sizing and chemical superscripts/subscripts without executable capabilities',()=>{
 const parsed=parseHtmlFormat('<div id="board" data-board-root="true" style="position:relative;width:800px;height:500px"><table id="table"><caption id="caption">Table</caption><colgroup><col style="width:100px"/></colgroup><tbody><tr><td id="matrix-cell-0-0">H<sub>2</sub>O</td></tr></tbody></table><p id="power">x<sup>2</sup></p><p id="clause"><u>Clause</u></p></div>');
 assert.equal(parsed.valid,true);assert.match(parsed.html,/<sub>2<\/sub>/);assert.match(parsed.html,/<col style=/);
});
