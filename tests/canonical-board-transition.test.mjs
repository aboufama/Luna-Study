import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionFixture,question} from './helpers/session-policy.mjs';
import {createJevCanvasRouter} from '../server/jev.mjs';
import {candidateBoardContext} from '../server/board-routing-context.mjs';

const x={...question,id:'x-target',question:'How do equal operations solve 2x + 3 = 11?'};
const y={...question,id:'y-target',question:'How do equal operations solve 3y - 6 = 9?'};
const scene=(id,content)=>({title:'Equation',mode:'patch',blocks:[{id,type:'latex',content}]});
const xBoard=scene('x-equation','2x+3=11'),yBoard=scene('y-equation','3y-6=9');
const shown=f=>f.messages.filter(m=>m.type==='canvas'&&m.visible);
const hints=f=>f.messages.filter(m=>m.type==='hint-state').at(-1);
async function fixture(t,decide,extra={}){
 const queue=new Map([x,y].map(q=>[q.id,q])),routes=[],events=[];
 const f=await sessionFixture(t,{greeting:{reply:x.question,questionId:x.id,board:xBoard},integrations:{
  diagnostics:{record:(_id,event)=>events.push(event)},
  questionBank:{topics:()=>[],context:()=>({topics:[{questions:[...queue.values()]}]}),resolve:(_,id)=>queue.get(id),consume:()=>[],consumeById:(_,id,reply)=>{const q=queue.get(id);if(!q||!reply.endsWith(q.question))return[];queue.delete(id);return[q];}},
  canvasRouter:{classify:async(text,context)=>{routes.push({text,context});return routes.length===1?{needsCanvas:true,candidateMatchesQuestion:true}:decide(text,context,routes.length);}},
  ...extra,
 }});
 await f.waitFor(()=>shown(f).length===1);return Object.assign(f,{routes,events});
}
async function replyWith(f,target,board,reply=target.question){await f.commit('Continue');f.calls.at(-1).resolve({reply,questionId:target.id,...(board?{board}:{})});await f.flush();}

test('new canonical target immediately hides the old board; old-target candidate cannot reopen it',async t=>{
 let resolve;const f=await fixture(t,()=>new Promise(r=>{resolve=r;}));
 await replyWith(f,y,scene('x-answer','x=4'),`The earlier answer is x equals four. ${y.question}`);
 assert.equal(f.messages.filter(m=>m.type==='canvas').at(-1).visible,false,'hide precedes the deferred classifier');
 assert.equal(hints(f).questionId,y.id);const context=f.routes.at(-1).context;
 assert.deepEqual(context.currentQuestion,{id:y.id,question:y.question});assert.match(context.candidateBoard.text,/x=4/);assert.equal(context.currentQuestion.answer,undefined);assert.equal(context.boardVisible,false);
 resolve({needsCanvas:true,candidateMatchesQuestion:false,shouldReopen:true});await f.flush();
 assert.equal(shown(f).length,1);assert.ok(f.events.some(e=>e.type==='whiteboard.not-shown'&&e.details.reason==='candidate-target-mismatch'));
 assert.equal(f.calls.length,2,'mismatched generated board does not launch recovery');
});

test('matching new canonical candidate replaces old objects even when model and router request a patch',async t=>{
 const f=await fixture(t,()=>({needsCanvas:false,candidateMatchesQuestion:true,shouldReplace:false}));
 await replyWith(f,y,yBoard);await f.waitFor(()=>shown(f).length===2);
 assert.deepEqual(shown(f).at(-1).board.blocks.map(b=>b.id),['y-equation']);assert.equal(hints(f).questionId,y.id);
});

test('same-target structured patch keeps its existing objects without a new match decision',async t=>{
 const f=await fixture(t,()=>({needsCanvas:false,candidateMatchesQuestion:null}));
 await replyWith(f,x,scene('x-step','2x=8'));await f.waitFor(()=>shown(f).length===2);
 assert.deepEqual(shown(f).at(-1).board.blocks.map(b=>b.id),['x-equation','x-step']);
 assert.equal(f.routes.at(-1).context.currentQuestion,undefined);assert.equal(f.routes.at(-1).context.candidateBoard,undefined);
});

test('missing or uncertain candidate match abstains despite structured content and reopen approval',async t=>{
 for(const match of [undefined,null]){
  const f=await fixture(t,()=>({needsCanvas:true,candidateMatchesQuestion:match,shouldReopen:true}));
  await replyWith(f,y,yBoard);assert.equal(shown(f).length,1);
  assert.equal(f.messages.filter(m=>m.type==='canvas').at(-1).visible,false);
  assert.ok(f.events.some(e=>e.type==='whiteboard.not-shown'&&e.details.reason==='candidate-target-uncertain'));
 }
});

test('matching decision from an interrupted turn cannot reopen the hidden scene',async t=>{
 let resolve;const f=await fixture(t,()=>new Promise(r=>{resolve=r;}));
 await replyWith(f,y,yBoard);await f.commit('Wait, I need a different topic');
 resolve({needsCanvas:true,candidateMatchesQuestion:true});await f.flush();
 assert.equal(shown(f).length,1);assert.ok(f.events.some(e=>e.type==='whiteboard.discarded'));
});

test('rejected transition stays scoped on later turns until a matching replacement is accepted',async t=>{
 let matching=false;
 const f=await fixture(t,()=>({needsCanvas:false,candidateMatchesQuestion:matching?true:null,shouldReopen:true,continuesWorkingProblem:true}));
 await replyWith(f,y,yBoard);assert.equal(shown(f).length,1);
 await f.commit('Repeat that');await f.complete(f.calls.at(-1),'Consider the current equation.');
 assert.equal(shown(f).length,1,'generic reopen approval cannot revive x on a subsequent y turn');
 assert.deepEqual(f.routes.at(-1).context.currentQuestion,{id:y.id,question:y.question});
 matching=true;await replyWith(f,y,yBoard);assert.deepEqual(shown(f).at(-1).board.blocks.map(b=>b.id),['y-equation']);
 await replyWith(f,y,scene('y-step','3y=15'));assert.deepEqual(shown(f).at(-1).board.blocks.map(b=>b.id),['y-equation','y-step']);
 assert.equal(f.routes.at(-1).context.currentQuestion,undefined,'matching replacement clears the pending transition');
});

test('recovery for a new canonical target draws only its exact question and then passes the same match gate',async t=>{
 const recovery=[];
 const f=await fixture(t,(_text,context)=>({needsCanvas:true,candidateMatchesQuestion:context.candidateBoard?true:null,shouldReopen:true}),{
  createLunaFastImpl:({mode})=>({ready:async()=>{},close:async()=>{},respond:async(input)=>{
   if(mode==='visual'){recovery.push(input);return{reply:'',board:yBoard};}
   return input.readinessContext.trigger==='session-start'?{reply:x.question,questionId:x.id,board:xBoard}:{reply:`The earlier answer is x equals four. ${y.question}`,questionId:y.id};
  }}),
 });
 await f.commit('Try the next problem');await f.waitFor(()=>shown(f).length===2);
 assert.equal(recovery.length,1);assert.equal(recovery[0].visualRecovery.reply,y.question);assert.deepEqual(recovery[0].visualRecovery.currentQuestion,{id:y.id,question:y.question});assert.equal(recovery[0].whiteboardContext,undefined);
 assert.deepEqual(shown(f).at(-1).board.blocks.map(b=>b.id),['y-equation']);
 assert.ok(f.routes.at(-1).context.candidateBoard);
});

test('confirmed departure from a pending canonical visual permits unrelated teaching without retaining old objects',async t=>{
 let departed=false;
 const f=await fixture(t,()=>({needsCanvas:true,candidateMatchesQuestion:null,continuesWorkingProblem:departed?false:null,shouldReopen:true}));
 await replyWith(f,y,yBoard);assert.equal(shown(f).length,1);
 departed=true;await f.commit('Teach me about cells instead');f.calls.at(-1).resolve({reply:'The membrane separates the inside from the outside.',board:{title:'Cell boundary',blocks:[{id:'membrane',type:'latex',content:'inside \\mid outside'}]}});await f.flush();
 assert.equal(shown(f).length,2);assert.deepEqual(shown(f).at(-1).board.blocks.map(b=>b.id),['membrane']);assert.equal(hints(f).questionId,null);
 await f.commit('Explain a little more');f.calls.at(-1).resolve({reply:'The boundary can regulate movement.',board:scene('transport','inside \\to outside')});await f.flush();
 assert.deepEqual(shown(f).at(-1).board.blocks.map(b=>b.id),['membrane','transport']);
});

test('blank matrix and unlabeled geometry expose physical structure to the same Jev request',async()=>{
 const matrix={title:'Blank game',blocks:[{id:'grid',type:'matrix',size:[8,10],cells:[]}]};
 const triangle={title:'Triangle',blocks:[{id:'triangle',type:'scene',width:800,height:500,objects:[{id:'edges',type:'polyline',points:[[100,100],[400,100],[100,400],[100,100]]}]}]};
 for(const [board,target,check]of[[matrix,'How many strict equilibria can an 8 by 10 game have?',shape=>assert.deepEqual(shape[0],{type:'matrix',rows:8,columns:10})],[triangle,'Which sides of this right triangle are perpendicular?',shape=>{assert.equal(shape[0].objects[0].type,'polyline');assert.deepEqual(shape[0].objects[0].points,[[100,100],[400,100],[100,400],[100,100]]);} ]]){
  const candidate=candidateBoardContext(board);assert.ok(candidate);check(JSON.parse(candidate.shape));let sent;
  const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'mock'},fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return{ok:true,json:async()=>({answers:{needs_canvas:{type:'noul',noul:.99},candidate_matches_question:{type:'noul',noul:.99}}})};}});
  const result=await router.classify('Consider this problem.',{phase:'study',currentQuestion:{id:'shape-question',question:target},candidateBoard:candidate});
  assert.ok(sent.questions.candidate_matches_question);assert.equal(result.candidateMatchesQuestion,true);check(JSON.parse(sent.state.context.candidateBoard.shape));
 }
});

test('Jev target match uses the existing call, strips private fields, and keeps uncertainty closed',async()=>{
 for(const [value,expected] of [[.99,true],[.9,true],[.85,true],[.7,true],[.6999,null],[.62,null],[.59,null],[.1,false],[0,false],[null,null],['yes',null]]){
  let calls=0,sent;const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'mock'},fetchImpl:async(_url,options)=>{calls++;sent=JSON.parse(options.body);return{ok:true,json:async()=>({answers:{needs_canvas:{type:'noul',noul:.5},candidate_matches_question:{type:'noul',noul:value}}})};}});
  const result=await router.classify('Previous x solution. New y question.',{phase:'study',currentQuestion:{...y,answer:'PRIVATE'},candidateBoard:{text:'3y-6=9',pixels:'PRIVATE'}});
  assert.equal(calls,1);assert.equal(result.candidateMatchesQuestion,expected);assert.ok(sent.questions.needs_canvas);assert.ok(sent.questions.candidate_matches_question);assert.equal(JSON.stringify(sent).includes('PRIVATE'),false);assert.deepEqual(sent.state.context.currentQuestion,{id:y.id,question:y.question});
 }
 const context={phase:'study',currentQuestion:{id:y.id,question:y.question},candidateBoard:{text:'3y-6=9'}};
 assert.equal((await createJevCanvasRouter({env:{}}).classify('Equation',context)).candidateMatchesQuestion,null);
});

test('display relevance boundary does not loosen working-question identity',async()=>{
 const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'mock'},fetchImpl:async()=>({ok:true,json:async()=>({answers:{needs_canvas:{type:'noul',noul:.5},candidate_matches_question:{type:'noul',noul:.7},continues_working_problem:{type:'noul',noul:.7}}})})});
 const result=await router.classify('Inspect the proposed equation.',{phase:'study',currentQuestion:{id:y.id,question:y.question},workingProblem:{question:y.question},candidateBoard:{text:'3y-6=9'}});
 assert.equal(result.candidateMatchesQuestion,true);
 assert.equal(result.continuesWorkingProblem,null);
 assert.equal(result.candidateMatchProbability,.7);
});
