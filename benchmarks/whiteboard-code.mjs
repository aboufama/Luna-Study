// Additional representation arms: actual Canvas 2D JavaScript and React JSX.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {universalScenarios,universalInstructions} from './whiteboard-formats/universal-scenarios.mjs';
import {scenarios,commonInstructions} from './whiteboard-formats/scenarios.mjs';
import {codePrompts,renderCode} from './whiteboard-code-render.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
const live=process.argv.includes('--live'),universal=process.argv.includes('--universal'),dir=new URL('./whiteboard-code/',import.meta.url);
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex'),ms=x=>Math.round(x*10)/10;
const report={version:1,startedAt:new Date().toISOString(),model:'gpt-6-luna',reasoning:'low',live,budget:{limit:universal?12:18,calls:0},runs:[],method:'Same seven source-fact cases. Static drawing-request to complete, compiled, isolated browser rendering; excludes voice, retrieval and Jev. React library preloaded/bundled, browser startup excluded. Fresh800x500 opaque iframe per drawing; generated code has no network, app state or credentials. Whole-scene redraw updates preserve registered semanticIDs; this does not implement a retained production world.',libraries:{react:JSON.parse(await readFile(new URL('../node_modules/react/package.json',import.meta.url),'utf8')).version},sources:['https://react.dev/reference/react-dom/client/createRoot','https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D'],promptMetadata:Object.fromEntries(Object.entries(codePrompts).map(([key,prompt])=>[key,{sha256:sha((universal?universalInstructions:commonInstructions)+'\n'+prompt),bytes:Buffer.byteLength((universal?universalInstructions:commonInstructions)+'\n'+prompt)}]))};
const browser=await chromium.launch({headless:true});
const recordsFile=new URL(live?(universal?'universal-results.json':'results.json'):'dry-run.json',dir),save=()=>writeFile(recordsFile,JSON.stringify(report,null,2)+'\n');
function check(s,r,previous){
 const x=r.render,txt=x.texts.map(t=>t.text),all=txt.join(' '),norm=all.replace(/\s/g,'');
 const c={uniqueIds:x.duplicateIds.length===0,selectableObjects:x.ids.length>0,noClippedLabels:x.clippedLabels.length===0,readableLabels:x.smallLabels.length===0,noExternalRequests:r.blockedRequests.length===0};
 const cells=x.hits.filter(h=>/cell/i.test(h.id));
 if(s.id==='payoff-matrix'){c.exactPayoffs=s.facts.rows.flat().every(v=>norm.includes(v.replace(/\s/g,'')));c.axisLabels=['U','D','L','R'].every(v=>txt.includes(v));c.fullCellHitAreas=cells.length===4&&cells.every(h=>h.width>30&&h.height>20);r.requiresManualCellPlacement=true;}
 if(s.id==='blank-grid'){c.exact80Cells=cells.length===80;const quant=values=>new Set(values.map(v=>Math.round(v*2)/2)).size;c.exact8Rows10Columns=quant(cells.map(h=>h.y+h.height/2))===8&&quant(cells.map(h=>h.x+h.width/2))===10;c.axisLabels=Array.from({length:8},(_,i)=>`r${i+1}`).concat(Array.from({length:10},(_,i)=>`c${i+1}`)).every(v=>txt.includes(v));c.noInventedCellValues=!x.texts.some(t=>cells.some(cell=>t.x+t.width/2>cell.x+1&&t.x+t.width/2<cell.x+cell.width-1&&t.y+t.height/2>cell.y+1&&t.y+t.height/2<cell.y+cell.height-1));r.extraGridLabels=txt.filter(v=>!/^r[1-8]$|^c(?:[1-9]|10)$/.test(v));c.fullCellHitAreas=cells.length===80&&cells.every(h=>h.width>10&&h.height>10);}
 if(['line-city','patch-city'].includes(s.id)){c.positionLabels=all.includes('0.8')&&all.includes(s.id==='patch-city'?'0.3':'0.2');c.vendorLabels=/\bA\b/.test(all)&&/\bB\b/.test(all);c.endpointLabels=txt.includes('0')&&txt.includes('1');r.requiresManualGeometryReview=true;if(previous?.render){c.preservePriorIds=previous.render.ids.every(id=>x.ids.includes(id));r.editStats={before:previous.render.hits,after:x.hits,priorIds:previous.render.ids.length,retainedIds:previous.render.ids.filter(id=>x.ids.includes(id)).length};}}
 if(s.id==='game-tree'){c.exactPayoffs=['(3,2)','(0,0)','(1,1)','(2,3)'].every(v=>norm.includes(v));c.players=all.includes('P1')&&all.includes('P2');c.actions=['L','R','l','r'].every(v=>txt.includes(v));r.requiresManualEdges=true;}
 if(s.id==='function-plot'){c.hasAxes=txt.includes('x')&&txt.includes('y');c.domainLabels=txt.some(t=>/[-−]2/.test(t))&&txt.includes('4');r.requiresManualGeometryReview=true;}
 if(s.id==='process'){c.exactSteps=['Observe','Hypothesize','Test','Revise'].every(v=>all.includes(v));r.requiresManualEdges=true;}
 if(s.id==='biology-cell'){c.labels=['cell membrane','cytoplasm','nucleus'].every(v=>all.toLowerCase().includes(v));c.teachingNote=all.includes('Membrane: selective boundary');r.requiresManualContainment=true;}
 if(s.id==='chemistry-equation'){c.note=all.includes('Atoms conserved');c.chemicalElements=all.includes('H')&&all.includes('O');r.requiresManualStoichiometry=true;}
 if(s.id==='algebra-steps'){c.exactEquations=s.facts.steps.every(v=>norm.includes(v.replace(/\s/g,'')));c.operations=s.facts.operations.every(v=>all.includes(v));r.requiresManualAlignment=true;}
 if(s.id==='physics-forces'){c.forceLabels=['N','mg','F','f'].every(v=>txt.includes(v));c.equationsPresent=all.includes('ma')&&all.includes('mg');r.requiresManualForceDirections=true;}
 if(s.id==='history-timeline'){c.events=s.facts.events.every(e=>all.includes(String(e.year))&&all.includes(e.label));r.requiresManualProportionalSpacing=true;}
 if(s.id==='grammar-annotation'){c.sentence=s.facts.clauses.every(clause=>all.includes(clause.text));c.clauseLabels=s.facts.clauses.every(clause=>all.includes(clause.label));r.requiresManualAnnotation=true;}
 return c;
}
async function generate(format,s,previous){
 const payload={model:report.model,store:false,stream:true,tools:[],reasoning:{effort:'low'},max_output_tokens:7000,instructions:(universal?universalInstructions:commonInstructions)+'\n'+codePrompts[format],input:JSON.stringify({request:s.request,sourceFacts:s.facts,...(previous?{previousScene:previous.raw}:{})})};
 const r={id:`${s.id}-${format}-1`,scenario:s.id,format,round:1,status:'pending',sourceFactsSha256:sha(s.facts),instructionBytes:Buffer.byteLength(payload.instructions),inputBytes:Buffer.byteLength(payload.input),raw:'',ttftMs:null};
 let started;
 try{
  if(live){await withProviderSlot(async()=>{
   if(report.budget.calls>=report.budget.limit)throw Error('Paid call cap reached');report.budget.calls++;started=performance.now();
   const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});r.httpStatus=response.status;if(!response.ok)throw Error(`HTTP ${response.status}`);
   let buffer='',complete=false;const decoder=new TextDecoder();
   for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let match;while(match=/\r?\n\r?\n/.exec(buffer)){const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=frame.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n');if(!data||data==='[DONE]')continue;const event=JSON.parse(data);if(event.type==='response.output_text.delta'&&event.delta){r.ttftMs??=ms(performance.now()-started);r.raw+=event.delta;if(r.raw.length>50000)throw Error('Oversize output');}if(event.type==='response.completed'){r.usage=event.response?.usage;r.providerModel=event.response?.model;r.serviceTier=event.response?.service_tier;if(event.response?.status!=='completed')throw Error('Incomplete');const final=event.response.output.filter(i=>i.type==='message').flatMap(i=>i.content||[]).filter(p=>p.type==='output_text').map(p=>p.text).join('');if(final!==r.raw)throw Error('Output mismatch');complete=true;}if(['response.failed','response.incomplete','error'].includes(event.type))throw Error('Provider failed');}}
   if(!complete)throw Error('Missing completed event');r.generationMs=ms(performance.now()-started);
  });}else{started=performance.now();r.raw=format==='canvas'?'function draw(ctx,hit){for(let r=0;r<8;r++){ctx.fillText("r"+(r+1),10,60+r*40);for(let c=0;c<10;c++){ctx.strokeRect(55+c*65,35+r*40,65,40);hit("cell-r"+r+"-c"+c,55+c*65,35+r*40,65,40);}}for(let c=0;c<10;c++)ctx.fillText("c"+(c+1),75+c*65,25);}':'function Board(){return <table style={{position:"absolute",left:50,top:50,borderCollapse:"collapse"}}><thead><tr><th></th>{Array.from({length:10},(_,c)=><th key={c}>{"c"+(c+1)}</th>)}</tr></thead><tbody>{Array.from({length:8},(_,r)=><tr key={r}><th>{"r"+(r+1)}</th>{Array.from({length:10},(_,c)=><td key={c} data-id={"cell-r"+r+"-c"+c} style={{width:60,height:40,border:"1px solid black"}}></td>)}</tr>)}</tbody></table>}';r.generationMs=0;}
  const rendering=performance.now();Object.assign(r,await renderCode(browser,format,r.raw,{screenshot:new URL(`${r.id}.png`,dir).pathname}));r.renderMs=ms(performance.now()-rendering);r.validRenderMs=ms(r.renderReadyAt-started);r.outputBytes=Buffer.byteLength(r.raw);r.checks=check(s,r,previous);r.status='rendered';await writeFile(new URL(`${r.id}.html`,dir),r.html);delete r.html;
 }catch(error){r.status='failed';r.error=String(error.message).slice(0,240);r.elapsedMs=started?ms(performance.now()-started):null;}
 return r;
}
try{
 await mkdir(dir,{recursive:true});const previous=new Map();
 for(const [i,s] of (live?(universal?universalScenarios.filter(s=>s.id!=='multiseries-chart'):scenarios):[scenarios.find(s=>s.id==='blank-grid')]).entries())for(const format of i%2?['react','canvas']:['canvas','react']){
  const r=await generate(format,s,s.previous?previous.get(`${s.previous}/${format}`):null);report.runs.push(r);if(r.status==='rendered')previous.set(`${s.id}/${format}`,r);await save();console.log(JSON.stringify({id:r.id,status:r.status,ttftMs:r.ttftMs,validRenderMs:r.validRenderMs,checks:r.checks,error:r.error,calls:report.budget.calls}));
 }
}finally{report.finishedAt=new Date().toISOString();await save();await browser.close();}
