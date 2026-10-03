// HTML extension: 13 requested samples, strict ceiling 15; default is offline.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
import {scenarios,commonInstructions} from './whiteboard-formats/scenarios.mjs';
import {htmlFormatPrompt,parseHtmlFormat,htmlDocument} from './whiteboard-html.mjs';
import {formatPrompts,parseFormat} from './whiteboard-formats-render.mjs';
import {universalScenarios} from './whiteboard-formats/universal-scenarios.mjs';
const dir=new URL('./whiteboard-formats/',import.meta.url),live=process.argv.includes('--live'),universal=process.argv.includes('--universal');
const file=name=>new URL(name,dir),sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex'),ms=x=>Math.round(x*10)/10;
const phaseInstructions=universal?commonInstructions.replace('Do not invent answers, solve unattempted problems, or add prose paragraphs.','Render explicitly requested teaching notes, annotations and supplied worked steps; do not invent answers or solve beyond supplied facts.'):commonInstructions;
const instructionFor=format=>phaseInstructions+'\n'+(format==='html'?htmlFormatPrompt:formatPrompts[format]);
const instructions=instructionFor('html');
const report={version:1,startedAt:new Date().toISOString(),model:'gpt-6-luna',reasoning:'low',format:universal?'html+dsl':'html',phase:universal?'universal':'initial-html',liveProviders:live,budget:{maximumPaidRequests:universal?12:15,paidRequests:0},instructionBytes:Buffer.byteLength(instructions),instructionSha256:sha(instructions),instructions,instructionsByFormat:universal?{html:instructionFor('html'),dsl:instructionFor('dsl')}:{html:instructions},runs:[],methodology:{comparison:'Later matched-input extension to original 36 calls; not time-interleaved or counterbalanced against them.',clock:'Before OpenAI fetch to completed stream, strict format validation, font readiness, and two animation frames in real Chromium at 800×500. No speech, routing, retrieval or UI animation.',ttft:'First nonempty output_text delta; original sweep used the first delta without the nonempty qualification.',isolation:'Validated static HTML/CSS only. No embedded SVG, scripts, external resources, forms or URLs. Render in sandbox allow-same-origin iframe with default-src none CSP; browser denies all network.',edits:'Full replacement with stable semantic IDs; compare actual geometry of unaffected objects. Camera persistence across real application revisions is not claimed.'}};
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1000,height:700}}),network=[];
page.setDefaultTimeout(5000);await page.route('**/*',route=>{network.push(route.request().url());return route.abort()});
await page.setContent('<!doctype html><html><body style="margin:0"><iframe id="frame" sandbox="allow-same-origin" style="width:800px;height:500px;border:0"></iframe></body></html>');
const documentForHtml=html=>htmlDocument({valid:true,html});
async function inspectHtml(html){
 return page.evaluate(async documentHtml=>{
  const frame=document.querySelector('#frame');
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('iframe load timeout')),4000);frame.onload=()=>{clearTimeout(timeout);resolve()};frame.srcdoc=documentHtml});
  const doc=frame.contentDocument,win=frame.contentWindow,root=doc.querySelector('[data-board-root]');if(!root)throw Error('No board root');
  await doc.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
  const bounds=root.getBoundingClientRect(),box=el=>{const b=el.getBoundingClientRect();return{x:b.x-bounds.x,y:b.y-bounds.y,width:b.width,height:b.height,cx:b.x-bounds.x+b.width/2,cy:b.y-bounds.y+b.height/2}};
  const texts=[],walker=doc.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){const node=walker.currentNode,text=node.textContent.trim();if(!text||node.parentElement.closest('style'))continue;const range=doc.createRange();range.selectNodeContents(node);const style=win.getComputedStyle(node.parentElement);texts.push({text,id:node.parentElement.closest('[id]')?.id||null,...box(range),fontSize:parseFloat(style.fontSize),effectiveFontSize:parseFloat(style.fontSize)});}
  const geometry=[...root.querySelectorAll('*')].filter(el=>el.tagName!=='STYLE').map(el=>{const style=win.getComputedStyle(el);return{id:el.id||null,tag:el.tagName.toLowerCase(),ownerId:el.closest('[id]')?.id||null,classes:el.className,...box(el),borderRadius:style.borderRadius,borderTopWidth:style.borderTopWidth,borderRightWidth:style.borderRightWidth,borderBottomWidth:style.borderBottomWidth,borderLeftWidth:style.borderLeftWidth,background:style.backgroundColor,color:style.color,pointerEvents:style.pointerEvents,transform:style.transform};});
  const ids=[root.id,...root.querySelectorAll('[id]')].map(x=>typeof x==='string'?x:x.id);
  const cells=[...root.querySelectorAll('[id]')].filter(el=>/-cell-\d+-\d+$/.test(el.id)).map(el=>{const b=el.getBoundingClientRect();const offsets=[[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]];return{id:el.id,...box(el),text:el.textContent.trim(),hits:offsets.map(([x,y])=>{const hit=doc.elementFromPoint(b.x+b.width*x,b.y+b.height*y);return Boolean(hit&&(hit===el||el.contains(hit)))})};});
  const overlaps=[];for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){const a=texts[i],b=texts[j],w=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),h=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);if(w>2&&h>2&&w*h>Math.min(a.width*a.height,b.width*b.height)*.12)overlaps.push({a:a.text,b:b.text});}
  return {texts,ids,geometry,cells,width:bounds.width,height:bounds.height,viewBox:`0 0 ${bounds.width} ${bounds.height}`,selectableIds:ids,duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i),clippedLabels:texts.filter(t=>t.x<-.5||t.y<-.5||t.x+t.width>800.5||t.y+t.height>500.5),smallLabels:texts.filter(t=>t.effectiveFontSize<11),overlappingLabels:overlaps,htmlForeignObjects:root.querySelectorAll('svg,iframe,object,embed,img,script').length};
 },documentForHtml(html));
}
function cityGeometry(render,expected){
 const axes=render.geometry.filter(s=>s.width>250&&s.height<=5&&s.height>0).sort((a,b)=>b.width-a.width);
 const points=render.geometry.filter(s=>s.width>=4&&s.width<=30&&Math.abs(s.width-s.height)<2&&parseFloat(s.borderRadius)>=s.width/3);
 const closest=name=>{let found=null,distance=Infinity;for(const point of points)for(const label of render.texts.filter(t=>new RegExp(`\\b${name}\\b`).test(t.text))){const d=Math.hypot(point.cx-label.cx,point.cy-label.cy);if(d<distance){found=point;distance=d}}return found};
 const axis=axes[0],A=closest('A'),B=closest('B');return{valid:Boolean(axis&&A&&B&&A!==B&&Math.abs(A.cy-axis.cy)<3&&Math.abs(B.cy-axis.cy)<3&&Math.abs((A.cx-axis.x)/axis.width-expected)<.01&&Math.abs((B.cx-axis.x)/axis.width-.8)<.01),axis,A,B};
}
function checksFor(scenario,record,previous){
 const r=record.render,texts=r.texts.map(t=>t.text),all=texts.join(' '),norm=s=>s.replace(/[()\s]/g,'');
 const checks={noExternalContent:r.htmlForeignObjects===0,uniqueIds:r.duplicateIds.length===0,noClippedLabels:r.clippedLabels.length===0,readableLabels:r.smallLabels.length===0,noOverlappingLabels:r.overlappingLabels.length===0,correctRootDimensions:r.width===800&&r.height===500};
 if(scenario.id==='blank-grid'){
  const coords=r.cells.map(c=>(c.id.match(/-cell-(\d+)-(\d+)$/)||[]).slice(1).map(Number));
  checks.exact80Cells=coords.length===80&&new Set(coords.map(c=>c.join(':'))).size===80&&coords.every(([row,col])=>row>=0&&row<8&&col>=0&&col<10);
  const cell=(row,col)=>r.cells.find(c=>c.id.endsWith(`-cell-${row}-${col}`));
  checks.physical8By10=checks.exact80Cells&&coords.every(([row,col])=>{const c=cell(row,col),firstRow=cell(0,col),firstCol=cell(row,0);return c.width>5&&c.height>5&&Math.abs(c.cx-firstRow.cx)<1&&Math.abs(c.cy-firstCol.cy)<1&&(col===0||c.x>=cell(row,col-1).x+cell(row,col-1).width-1)&&(row===0||c.y>=cell(row-1,col).y+cell(row-1,col).height-1)});
  checks.allAxisLabels=[...Array.from({length:8},(_,i)=>`r${i+1}`),...Array.from({length:10},(_,i)=>`c${i+1}`)].every(label=>texts.includes(label));
  checks.noInventedCellValues=r.cells.every(c=>c.text==='');checks.cellHitTargets=r.cells.length===80&&r.cells.every(c=>c.hits.every(Boolean));
 }
 if(scenario.id==='payoff-matrix'){
  checks.exactPayoffs=scenario.facts.rows.flat().every(value=>norm(all).includes(norm(value)));checks.axisLabels=['U','D','L','R'].every(t=>texts.includes(t));
  checks.correctPayoffCellPlacement=scenario.facts.rows.every((row,i)=>row.every((value,j)=>{const cell=r.cells.find(c=>c.id.endsWith(`-cell-${i}-${j}`));return cell&&norm(cell.text)===norm(value)}));checks.cellHitTargets=r.cells.length===4&&r.cells.every(c=>c.hits.every(Boolean));
 }
 if(['line-city','patch-city'].includes(scenario.id)){
  checks.positionLabels=all.includes('0.8')&&all.includes(scenario.id==='patch-city'?'0.3':'0.2');checks.endpoints=texts.includes('0')&&texts.includes('1');record.city=cityGeometry(r,scenario.id==='patch-city'?.3:.2);checks.correctSharedCityGeometry=record.city.valid;
  if(previous){checks.preservePriorIds=previous.render.ids.every(id=>r.ids.includes(id));const close=(a,b)=>a&&b&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<.1);checks.unchangedCityAndB=Boolean(close(previous.city?.axis,record.city.axis)&&close(previous.city?.B,record.city.B));checks.sameLogicalRoot=r.viewBox===previous.render.viewBox;record.editStats={priorIds:previous.render.ids.length,retainedIds:previous.render.ids.filter(id=>r.ids.includes(id)).length};}
 }
 if(scenario.id==='game-tree'){checks.exactPayoffs=['(3,2)','(0,0)','(1,1)','(2,3)'].every(value=>norm(all).includes(norm(value)));checks.players=all.includes('P1')&&all.includes('P2');checks.actions=['L','R','l','r'].every(value=>texts.includes(value));record.requiresManualEdgeReview=true;}
 if(scenario.id==='function-plot'){checks.hasAxes=texts.includes('x')&&texts.includes('y');checks.domainLabels=/[-−]2/.test(all)&&/\b4\b/.test(all);record.requiresManualGeometryReview=true;}
 if(scenario.id==='process'){checks.exactSteps=['Observe','Hypothesize','Test','Revise'].every(value=>texts.includes(value));record.requiresManualEdgeReview=true;}
 return checks;
}
function universalChecks(scenario,record){
 const r=record.render,texts=r.texts.map(t=>t.text),all=texts.join(' '),flat=all.replace(/\s/g,'').replaceAll('₂','2').replaceAll('−','-');
 const checks={uniqueIds:r.duplicateIds.length===0,noClippedLabels:r.clippedLabels.length===0,readableLabels:r.smallLabels.length===0,noOverlappingLabels:r.overlappingLabels.length===0,correctRootDimensions:r.width===800&&r.height===500};
 if(scenario.id==='biology-cell')checks.requiredLabels=['cell membrane','cytoplasm','nucleus',scenario.facts.note].every(t=>all.toLowerCase().includes(t.toLowerCase()));
 if(scenario.id==='chemistry-equation'){checks.equationText=flat.includes('2H2+O2→2H2O');checks.teachingNote=all.includes('Atoms conserved');}
 if(scenario.id==='algebra-steps'){checks.exactSteps=scenario.facts.steps.every(t=>flat.includes(t.replace(/\s/g,'')));checks.annotations=scenario.facts.operations.every(t=>all.toLowerCase().includes(t.toLowerCase()));}
 if(scenario.id==='physics-forces'){checks.forceLabels=['N','mg','F','f'].every(t=>texts.includes(t));checks.equations=scenario.facts.equations.every(t=>flat.includes(t.replace(/\s/g,'').replaceAll('−','-')));}
 if(scenario.id==='history-timeline'){checks.requiredEvents=scenario.facts.events.every(e=>all.includes(String(e.year))&&all.includes(e.label));checks.heading=all.includes(scenario.facts.heading);}
 if(scenario.id==='grammar-annotation'){checks.sentence=flat.includes(scenario.facts.sentence.replace(/\s/g,''));checks.clauseLabels=scenario.facts.clauses.every(c=>all.includes(c.label));}
 record.requiresManualGeometryReview=true;return checks;
}
function dryResponse(format){const raw=format==='dsl'?JSON.stringify({title:'Offline DSL',mode:'replace',objects:[{id:'note',type:'text',x:10,y:10,text:'Offline DSL fixture'}]}):'<div id="board" data-board-root="true" style="position:relative;width:800px;height:500px;"><p id="label" style="position:absolute;left:40px;top:40px;font-size:18px;">Offline HTML fixture</p></div>';return new Response(new ReadableStream({start(controller){for(const event of [{type:'response.output_text.delta',delta:raw},{type:'response.completed',response:{status:'completed',usage:{input_tokens:100,output_tokens:50},output:[{type:'message',content:[{type:'output_text',text:raw}]}]}}])controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));controller.close()}}));}
const generate=(...args)=>live?withProviderSlot(()=>generateUnlocked(...args)):generateUnlocked(...args);
async function generateUnlocked(scenario,round,previous,format='html'){
 const instructions=instructionFor(format);
 const input=JSON.stringify({request:scenario.request,sourceFacts:scenario.facts,...(previous?{previousScene:previous.raw}:{})});
 const record={id:`${scenario.id}-${format}-${round}`,scenario:scenario.id,format,round,status:'pending',request:scenario.request,sourceFactsSha256:sha(scenario.facts),inputBytes:Buffer.byteLength(input),instructionBytes:Buffer.byteLength(instructions),raw:'',usage:null,ttftMs:null};
 const start=performance.now();
 try{
  let response;if(live){if(report.budget.paidRequests>=report.budget.maximumPaidRequests)throw Error('HTML paid call ceiling reached');report.budget.paidRequests++;response=await fetch('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:report.model,store:false,stream:true,tools:[],reasoning:{effort:'low'},max_output_tokens:7000,instructions,input})});}else response=dryResponse(format);
  record.httpStatus=response.status;if(!response.ok)throw Error(`HTTP ${response.status}`);let buffer='',complete=false;const decoder=new TextDecoder();
  for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let match;while((match=/\r?\n\r?\n/.exec(buffer))){const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=frame.split(/\r?\n/).filter(s=>s.startsWith('data:')).map(s=>s.slice(5).trim()).join('\n');if(!data||data==='[DONE]')continue;const event=JSON.parse(data);if(event.type==='response.output_text.delta'){if(event.delta)record.ttftMs??=ms(performance.now()-start);record.raw+=event.delta;if(record.raw.length>50000)throw Error('Oversized drawing');}if(event.type==='response.completed'){record.usage=event.response?.usage||null;record.serviceTier=event.response?.service_tier||null;if(event.response?.status!=='completed')throw Error('Incomplete response');const final=event.response.output.filter(x=>x.type==='message').flatMap(x=>x.content).filter(x=>x.type==='output_text').map(x=>x.text).join('');assert.equal(record.raw,final);complete=true;}if(['response.failed','response.incomplete','error'].includes(event.type)){record.usage=event.response?.usage||null;throw Error('Provider response failed/incomplete');}}}
  if(!complete)throw Error('Missing completed response');record.generationMs=ms(performance.now()-start);record.outputBytes=Buffer.byteLength(record.raw);
  const parseStart=performance.now(),parsed=format==='html'?parseHtmlFormat(record.raw,{previous:previous?.scene}):parseFormat(format,record.raw,{previous:previous?.scene});record.validationMs=ms(performance.now()-parseStart);record.parseValid=parsed.valid;record.errors=parsed.errors;record.parserStats=parsed.stats;record.scene=parsed.scene;
  if(!parsed.valid){record.status='invalid';return record}
  if(parsed.html)record.html=parsed.html;if(parsed.svg)record.svg=parsed.svg;const renderStart=performance.now();record.render=await inspectHtml(parsed.html||'<div id="board" data-board-root="true" style="position:relative;width:800px;height:500px">'+parsed.svg+'</div>');record.browserRenderMs=ms(performance.now()-renderStart);record.validRenderMs=ms(performance.now()-start);record.checks=universal?universalChecks(scenario,record):checksFor(scenario,record,previous);record.status='rendered';await writeFile(file(`${live?'':'dry-'}${record.id}.${format==='html'?'html':'svg'}`),parsed.html?documentForHtml(parsed.html):parsed.svg);
 }catch(error){record.status='failed';record.error=String(error.message).slice(0,200);record.generationMs??=ms(performance.now()-start)}return record;
}
async function save(){await writeFile(file(universal?(live?'universal-results.json':'universal-dry-run.json'):(live?'html-results.json':'html-dry-run.json')),JSON.stringify(report,null,2)+'\n')}
try{
 await mkdir(dir,{recursive:true});if(live&&!process.env.OPENAI_API_KEY?.trim())throw Error('OpenAI configuration missing');const previous=new Map();
 const selectedScenarios=universal?universalScenarios.filter(s=>s.id!=='multiseries-chart'):scenarios;
 for(const [index,scenario] of selectedScenarios.entries())for(const format of universal?(index%2?['dsl','html']:['html','dsl']):['html']){const r=await generate(scenario,1,scenario.previous?previous.get(scenario.previous):null,format);report.runs.push(r);if(r.status==='rendered')previous.set(scenario.id,r);await save();console.log(JSON.stringify({id:r.id,status:r.status,ttftMs:r.ttftMs,validRenderMs:r.validRenderMs,checks:r.checks,errors:r.errors,error:r.error,paid:report.budget.paidRequests}))}
 if(live&&!universal)for(const round of [2,3])for(const scenario of scenarios.filter(s=>['blank-grid','line-city','game-tree'].includes(s.id))){const r=await generate(scenario,round);report.runs.push(r);await save();console.log(JSON.stringify({id:r.id,status:r.status,ttftMs:r.ttftMs,validRenderMs:r.validRenderMs,checks:r.checks,errors:r.errors,error:r.error,paid:report.budget.paidRequests}))}
}finally{report.finishedAt=new Date().toISOString();report.externalBrowserRequests=network;await save();await browser.close()}
