// Independent loopback review, entirely synthetic: no provider, microphone or user store.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {sessionFixture,question,study} from '../../tests/helpers/session-policy.mjs';
import {createJevCanvasRouter} from '../../server/jev.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=fileURLToPath(new URL('.',import.meta.url));
const original={...question,id:'audit-x',question:'How do equal operations solve 2x + 3 = 11, and why?'};
const next={...question,id:'audit-y',question:'How do equal operations solve 3y - 6 = 9, and why?'};
const initialBoard={title:'First equation',mode:'replace',blocks:[{id:'original-equation',type:'latex',content:'2x+3=11'},{id:'original-note',type:'text',content:'First problem'}]};
const nextPatch={title:'Next equation',mode:'patch',blocks:[{id:'next-equation',type:'latex',content:'3y-6=9'}]};
const cases=[];
async function check(id,run){const cleanup=[];try{await run({after:fn=>cleanup.push(fn)});cases.push({id,passed:true});}catch(error){cases.push({id,passed:false,error:error.message});}finally{for(const close of cleanup.reverse())await close();}}
function bank(){const ready=new Map([original,next].map(q=>[q.id,q]));return{topics:()=>[],context:()=>({topics:[{questions:[...ready.values()]}]}),resolve:(_,id)=>ready.get(id)||null,consume:()=>[],consumeById:(_,id,reply)=>{const q=ready.get(id);if(!q||reply!==q.question)return[];ready.delete(id);return[q];}};}
async function fixture(t,classify){const f=await sessionFixture(t,{start:{...study,title:'Equation transition review',materials:[{id:'notes',name:'Original',text:'For 2x+3=11 the solution is x=4. For 3y-6=9 the solution is y=5. Equal operations preserve equality.'}]},greeting:{reply:original.question,questionId:original.id,board:initialBoard},integrations:{questionBank:bank(),canvasRouter:{classify:(reply,context)=>context.currentQuestion?.id===original.id?Promise.resolve({...defaultDecision,candidateMatchesQuestion:true}):classify(reply,context)},intentRouter:{classify:()=>({answerAttempt:false,requestsHelp:false,examDeadline:false})}}});await f.waitFor(()=>f.messages.some(x=>x.type==='canvas'&&x.visible&&x.board),'initial board');return f;}
const defaultDecision={needsCanvas:false,shouldReopen:false,shouldReplace:false,continuesWorkingProblem:true,source:'jev'};
const afterCanvas=(f,index)=>f.messages.slice(index).filter(x=>x.type==='canvas');
async function transition(f){await f.commit('Please ask the next original problem.');const at=f.messages.length;f.calls.at(-1).resolve({reply:next.question,questionId:next.id,board:nextPatch});await f.flush();return at;}
// The current production contract is candidateMatchesQuestion. No fallback may
// synthesize that confidence from merely having a structured visual.
for(const [label,match]of [['missing',undefined],['unknown',null],['rejected',false]])await check(`transition-${label}-match-stays-hidden`,async t=>{
 let seen;
 const f=await fixture(t,async(_reply,context)=>{if(context.currentQuestion?.id===next.id){seen=context;return{...defaultDecision,needsCanvas:true,shouldReopen:true,...(match===undefined?{}:{candidateMatchesQuestion:match})};}return defaultDecision;});
 const at=await transition(f);await f.waitFor(()=>Boolean(seen),'transition classifier');await f.flush();
 assert.equal(seen.currentQuestion.question,next.question);assert.ok(seen.candidateBoard.text.includes('3y'));
 assert.ok(afterCanvas(f,at).some(x=>x.visible===false),'old scene closes before a new decision');assert.equal(afterCanvas(f,at).some(x=>x.visible===true),false,'unconfirmed candidate never opens');
});
await check('matching-new-target-replaces-all-old-blocks',async t=>{
 let seen;
 const f=await fixture(t,async(_reply,context)=>{if(context.currentQuestion?.id===next.id){seen=context;return{...defaultDecision,candidateMatchesQuestion:true};}return defaultDecision;});
 const at=await transition(f);await f.waitFor(()=>afterCanvas(f,at).some(x=>x.visible===true),'new scene');
 const board=afterCanvas(f,at).findLast(x=>x.visible===true).board;assert.deepEqual(board.blocks.map(x=>x.id),['next-equation']);assert.ok(seen);assert.ok(afterCanvas(f,at).some(x=>x.visible===false));
});
await check('same-target-structured-patch-retains-omitted-blocks',async t=>{
 const f=await fixture(t,async()=>defaultDecision);await f.commit('Please annotate this same problem.');const at=f.messages.length;
 f.calls.at(-1).resolve({reply:'Here is the current equation.',board:{title:'First equation',mode:'patch',blocks:[{id:'original-equation',type:'latex',content:'2x+3-3=11-3'}]}});await f.flush();await f.waitFor(()=>afterCanvas(f,at).some(x=>x.visible),'same problem patch');
 const board=afterCanvas(f,at).findLast(x=>x.visible).board;assert.deepEqual(board.blocks.map(x=>x.id),['original-equation','original-note']);assert.equal(afterCanvas(f,at).some(x=>x.visible===false),false);
});
await check('late-match-after-source-change-never-reopens',async t=>{
 let release,seen;
 const f=await fixture(t,(_reply,context)=>{if(context.currentQuestion?.id===next.id){seen=context;return new Promise(resolve=>{release=resolve;});}return Promise.resolve(defaultDecision);});
 const at=await transition(f);await f.waitFor(()=>Boolean(release),'pending classifier');await f.flush();assert.ok(seen);assert.ok(afterCanvas(f,at).some(x=>x.visible===false));
 await f.packet({type:'materials',materials:[{id:'changed',name:'New source',text:'New original source content.'}],indexStatus:'indexing'});const changed=f.messages.length;
 release({...defaultDecision,candidateMatchesQuestion:true,needsCanvas:true});await f.flush();await f.flush();assert.equal(afterCanvas(f,changed).some(x=>x.visible===true),false,'stale completion stays discarded');
});
await check('late-match-after-new-student-turn-never-reopens',async t=>{
 let release;
 const f=await fixture(t,(_reply,context)=>context.currentQuestion?.id===next.id?new Promise(resolve=>{release=resolve;}):Promise.resolve(defaultDecision));
 await transition(f);await f.waitFor(()=>Boolean(release),'pending classifier');await f.commit('Wait, pause that explanation.');const interrupted=f.messages.length;
 release({...defaultDecision,candidateMatchesQuestion:true});await f.flush();await f.flush();assert.equal(afterCanvas(f,interrupted).some(x=>x.visible===true),false);
});
await check('later-turn-cannot-reopen-old-target-after-rejected-transition',async t=>{
 const f=await fixture(t,async()=>({...defaultDecision,candidateMatchesQuestion:false,shouldReopen:true}));
 await transition(f);await f.flush();await f.commit('Show the current problem.');const at=f.messages.length;
 f.calls.at(-1).resolve({reply:'Here is the current problem.'});await f.flush();await f.flush();assert.equal(afterCanvas(f,at).some(x=>x.visible===true),false);
});
for(const [kind,block]of [
 ['blank-matrix',{id:'blank-grid',type:'matrix',rows:Array.from({length:8},()=>Array(10).fill(''))}],
 ['unlabeled-scene',{id:'geometry',type:'scene',width:800,height:500,objects:[{id:'shape',type:'rect',x:40,y:60,width:120,height:80}]}],
])await check(`shape-evidence-${kind}`,async t=>{
 let context;
 const f=await fixture(t,async(_reply,value)=>{context=value;return{...defaultDecision,candidateMatchesQuestion:true};});
 await f.commit('Show the next original problem.');const at=f.messages.length;
 f.calls.at(-1).resolve({reply:next.question,questionId:next.id,board:{title:'Supplied structure',mode:'replace',blocks:[block]}});await f.flush();await f.waitFor(()=>afterCanvas(f,at).some(x=>x.visible===true),'approved structure');
 const shape=context.candidateBoard.shape;assert.equal(typeof shape,'string');assert.ok(shape.trim());assert.ok(shape.length<=8000);
 if(kind==='blank-matrix'){assert.match(shape,/matrix/);assert.match(shape,/\b8\b/);assert.match(shape,/\b10\b/);}else{assert.match(shape,/rect/);assert.match(shape,/\b40\b/);}
});
await check('jev-receives-shape-without-visible-label-text',async()=>{
 let payload;
 const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'synthetic-review-key'},fetchImpl:async(_url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({answers:{needs_canvas:{type:'noul',noul:.99},candidate_matches_question:{type:'noul',noul:.95}}}),{headers:{'Content-Type':'application/json'}});}});
 const shape='matrix rows=8 columns=10; all cells blank';const decision=await router.classify('Here is the requested grid.',{phase:'study',hasBoardUpdate:true,currentQuestion:{id:'grid',question:'Show an eight by ten blank grid.'},candidateBoard:{text:'',shape}});
 assert.equal(decision.candidateMatchesQuestion,true);assert.equal(payload.state.context.candidateBoard.shape,shape);assert.ok(payload.questions.candidate_matches_question);
});
for(const [score,expected]of [[.70,true],[.69,null],[.10,false],[null,null]])await check(`jev-match-boundary-${score}`,async()=>{
 let payload;
 const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'synthetic-review-key'},fetchImpl:async(_url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({answers:{needs_canvas:{type:'noul',noul:.99},...(score===null?{}:{candidate_matches_question:{type:'noul',noul:score}})}}),{headers:{'Content-Type':'application/json'}});}});
 const decision=await router.classify('Here is the next problem.',{phase:'study',hasBoardUpdate:true,boardVisible:false,currentQuestion:{id:next.id,question:next.question},candidateBoard:{text:'3y - 6 = 9'}});
 assert.equal(decision.candidateMatchesQuestion,expected);assert.ok(payload.questions.candidate_matches_question);assert.equal(payload.state.context.currentQuestion.id,next.id);
});
await check('confirmed-departure-releases-pending-canonical-hold',async t=>{
 let departure=false;
 const f=await fixture(t,async()=>({...defaultDecision,needsCanvas:true,candidateMatchesQuestion:false,continuesWorkingProblem:!departure}));
 await transition(f);await f.flush();departure=true;await f.commit('Leave the problem and show a general explanation.');const at=f.messages.length;
 f.calls.at(-1).resolve({reply:'Here is the general relationship.',board:{title:'General relationship',mode:'patch',blocks:[{id:'general',type:'scene',width:800,height:500,objects:[{id:'circle',type:'ellipse',x:200,y:120,width:180,height:180,label:'Concept'}]}]}});await f.flush();await f.waitFor(()=>afterCanvas(f,at).some(x=>x.visible),'new freeform visual');
 assert.deepEqual(afterCanvas(f,at).findLast(x=>x.visible).board.blocks.map(x=>x.id),['general']);
 departure=false;await f.commit('Add a label to that explanation.');const current=f.calls.at(-1);assert.equal(current.input.workingProblem,null);const later=f.messages.length;
 current.resolve({reply:'Here is the additional label.',board:{title:'General relationship',mode:'patch',blocks:[{id:'caption',type:'text',content:'General relationship'}]}});await f.flush();await f.waitFor(()=>afterCanvas(f,later).some(x=>x.visible),'freeform follow-up');
 assert.deepEqual(afterCanvas(f,later).findLast(x=>x.visible).board.blocks.map(x=>x.id),['general','caption']);
});
const codeFiles=['server/live-voice.mjs','server/board-routing-context.mjs','server/openai-luna.mjs','tests/helpers/session-policy.mjs','server/jev.mjs','server/tutor-output.mjs','server/hint-policy.mjs','server/luna-fast.mjs','benchmarks/tutor-quality/review-transition-guard.mjs'];
const codeHashes=Object.fromEntries(await Promise.all(codeFiles.map(async path=>[path,createHash('sha256').update(await readFile(join(root,path))).digest('hex')])));
const report={finishedAt:new Date().toISOString(),command:'node benchmarks/tutor-quality/review-transition-guard.mjs',providerCalls:0,productionEdits:0,method:'Independent real WebSocket loopback with fake tutor, Jev and speech transport; source inputs are synthetic and stores are fixture-local. Semantic matching results are injected, so this verifies lifecycle enforcement, not classifier accuracy.',codeHashes,cases,counts:{total:cases.length,passed:cases.filter(x=>x.passed).length,failed:cases.filter(x=>!x.passed).length}};
await writeFile(join(dir,'transition-guard-review.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.counts));if(report.counts.failed)process.exitCode=1;
