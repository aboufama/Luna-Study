import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevCanvasRouter, fallbackCanvasDecision } from '../server/jev.mjs';

const response = probability => ({ ok: true, json: async () => ({ answers: { needs_canvas: { type: 'noul', noul: probability } } }) });

test('canvas routing records the provider resolved model and usage, including invalid decisions', async () => {
  const updates = [], finals = [];
  const router = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'mock-only' }, usageLedger: { start() { return { update: value => updates.push(value), finish: value => finals.push(value) }; } }, fetchImpl: async () => ({ ok: true, json: async () => ({ model: 'jev-2026-10', usage: { input_tokens: 40, output_tokens: 8 }, answers: {}, secret: 'never-forward' }) }) });
  await router.classify('Show this equation.', {}, { testId: 'mock-test' });
  assert.deepEqual(updates, [{ units: { inputTokens: 40, outputTokens: 8 }, model: 'jev-2026-10' }]);
  assert.deepEqual(finals, [{ status: 'failed' }]);
});

test('Jev uses the official typed API and only minimal public context', async () => {
  let sent;
  const router = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only-key' }, fetchImpl: async (url, options) => { sent = { url, options, body: JSON.parse(options.body) }; return response(.97); } });
  const result = await router.classify('Solve 2x + 4 = 10.', { title: 'Algebra', topic: 'Linear equations', phase: 'teaching', privateQuestionBank: [{ answer: 'PRIVATE' }], materials: [{ text: 'PRIVATE' }], masteryContext: { score: 3 } });
  assert.equal(sent.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.headers.Authorization, 'Bearer test-only-key');
  assert.equal(sent.body.questions.needs_canvas.type, 'noul');
  assert.match(sent.body.questions.needs_canvas.instructions,/"this matrix", "which cells"/);
  assert.match(sent.body.questions.needs_canvas.instructions,/only a short cue or question/);
  assert.match(sent.body.questions.needs_canvas.instructions,/simple recall questions answerable without consulting a visual/);
  assert.equal(sent.body.model, 'jev-latest');
  assert.deepEqual(sent.body.state.context, { title: 'Algebra', topic: 'Linear equations', phase: 'teaching' });
  assert.ok(!JSON.stringify(sent.body).includes('PRIVATE'));
  assert.equal(result.needsCanvas, true);
  assert.equal(result.source, 'jev');
  assert.ok(result.latencyMs >= 0);
  assert.ok(!JSON.stringify(result).includes('test-only-key'));
});

test('every reply is independently classified without treating verbal replies as hide instructions', async () => {
  let requests = 0;
  const router = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only-key' }, fetchImpl: async () => { requests++; return response(.03); } });
  assert.equal((await router.classify('Great, let us continue.')).needsCanvas, false);
  assert.equal((await router.classify('Great, let us continue.')).needsCanvas, false);
  assert.equal(requests, 2);
});

test('missing key and uncertainty use narrow deterministic teaching rules', async () => {
  const offline = createJevCanvasRouter({ env: {}, fetchImpl: () => { throw new Error('must not run'); } });
  assert.equal((await offline.classify('Let us solve 2x + 4 = 10.')).needsCanvas, true);
  for (const reply of ['Hello! When is your test?', 'Great work.', 'Mitochondria produce ATP.', 'What do mitochondria produce?']) {
    assert.equal((await offline.classify(reply)).needsCanvas, false, reply);
  }
  assert.equal(fallbackCanvasDecision('First upload your notes. Then we will check your materials.').needsCanvas, false);
  assert.equal(fallbackCanvasDecision('Draw a graph with time on the horizontal axis.').needsCanvas, true);
  assert.equal(fallbackCanvasDecision('We do not need a diagram.').needsCanvas, false);
  const uncertain = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only-key' }, fetchImpl: async () => response(.5) });
  const result = await uncertain.classify('The derivative of x squared is 2x.');
  assert.equal(result.needsCanvas, true);
  assert.equal(result.fallbackReason, 'uncertain');
});

test('uncertain routing still recognizes concrete game grids and explicit current visual requests',async()=>{
  const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'test-only'},fetchImpl:async()=>response(.43)});
  for(const reply of [
    'In an 8-by-10 game, what is the maximum possible number of strict Nash equilibria, and why?',
    'Which cells are Nash equilibria?',
    'Compare the entries in this matrix.',
  ]){
    const result=await router.classify(reply,{phase:'study',boardVisible:false});
    assert.equal(result.needsCanvas,true);assert.equal(result.source,'fallback');
  }
  const request={phase:'study',conversation:[{role:'user',content:'Could you show the current payoff matrix on the whiteboard?'}]};
  assert.equal(fallbackCanvasDecision('Here it is again.',request).needsCanvas,true);
  assert.equal(fallbackCanvasDecision('I cannot show that without the missing payoff values.',request).needsCanvas,false);
  for(const reply of ['What is a Nash equilibrium?','We can look at an 8-by-10 game later.','You are welcome.','What do cells need for active transport?'])assert.equal(fallbackCanvasDecision(reply,{phase:'study'}).needsCanvas,false,reply);
  for(const content of ['Do not show the matrix.','Close the whiteboard.','Voice only, please.'])assert.equal(fallbackCanvasDecision('Which cells are Nash equilibria?',{phase:'study',conversation:[{role:'user',content}]}).needsCanvas,false,content);
  assert.equal(fallbackCanvasDecision('Which cells are Nash equilibria?',{phase:'study',conversation:[{role:'user',content:'Do not show me the answer.'}]}).needsCanvas,true,'withholding an answer does not forbid the problem visual');
  assert.equal(fallbackCanvasDecision('Which cells are Nash equilibria?',{...request,phase:'setup'}).needsCanvas,false);
});

test('setup responses stay conversational even if provider overpredicts visuals', async () => {
  const router = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only-key' }, fetchImpl: async () => response(.99) });
  const result = await router.classify('Your test is October 15.', { phase: 'setup' });
  assert.equal(result.needsCanvas, false);
  assert.equal(result.reason, 'session-setup');
});

test('slow headers and slow body reads share a hard deadline and abort their request', async () => {
  for (const slowBody of [false, true]) {
    let signal;
    const router = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only-key' }, timeoutMs: 15, fetchImpl: async (_, options) => {
      signal = options.signal;
      return slowBody ? { ok: true, json: () => new Promise(() => {}) } : new Promise(() => {});
    } });
    const started = performance.now();
    const result = await router.classify('Solve x + 2 = 5.');
    assert.equal(result.needsCanvas, true);
    assert.equal(result.fallbackReason, 'timeout');
    assert.equal(signal.aborted, true);
    assert.ok(performance.now() - started < 300);
  }
});

test('malformed and unavailable provider results never interrupt voice or reveal errors', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false }),
    async () => { throw new Error('SECRET in raw provider error'); },
    async () => response('yes'),
    async () => response(NaN),
    async () => response(1.1),
    async () => ({ ok: true, json: async () => ({ answers: { needs_canvas: { type: 'choice', noul: .9 } } }) }),
  ]) {
    const result = await createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only-key' }, fetchImpl }).classify('Hi there.');
    assert.equal(result.source, 'fallback');
    assert.equal(result.needsCanvas, false);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
});

const boardContext = {
  phase: 'study', boardVisible: true, hasBoardUpdate: false,
  existingBoard: { title: 'Payoff game', text: 'Up | 3, 2 | 0, 1', privateAnswer: 'PRIVATE' },
  conversation: [{ role: 'user', content: 'I understand this now. Can we go back to talking?' }, { role: 'assistant', content: 'Yes, we can leave this example and discuss the next topic.' }],
};
const visualResponse = (needs, close) => ({ ok: true, json: async () => ({ answers: { needs_canvas: { type: 'noul', noul: needs }, close_canvas: { type: 'noul', noul: close } } }) });

test('closing an active scene is a separate contextual classification, not absence of new visuals', async () => {
  let sent;
  const router = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only' }, fetchImpl: async (_, options) => { sent = JSON.parse(options.body); return visualResponse(.05, .98); } });
  const decision = await router.classify('Yes, we can leave this example and discuss the next topic.', boardContext);
  assert.equal(decision.shouldClose, true);
  assert.equal(sent.questions.close_canvas.type, 'noul');
  assert.deepEqual(sent.state.context.conversation, boardContext.conversation);
  assert.deepEqual(sent.state.context.existingBoard, { title: 'Payoff game', text: 'Up | 3, 2 | 0, 1' });
  assert.ok(!JSON.stringify(sent).includes('PRIVATE'));
  assert.match(sent.questions.close_canvas.instructions, /spoken hint/);
  assert.match(sent.questions.close_canvas.instructions, /no newly generated board is NOT enough/);
});

test('hints, praise, ambiguous completion and missing close classification preserve existing scenes', async () => {
  for (const [reply, close] of [['Compare the other row.', .02], ['Exactly, well done.', .2], ['Let us continue.', .6], ['That finishes the first step.', .84]]) {
    const router = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only' }, fetchImpl: async () => visualResponse(.03, close) });
    assert.equal((await router.classify(reply, boardContext)).shouldClose, false);
  }
  for (const fetchImpl of [async () => response(.03), async () => visualResponse(.03, 'yes'), async () => { throw Error('offline'); }]) {
    const router = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only' }, fetchImpl });
    assert.equal((await router.classify('We are done with this example.', boardContext)).shouldClose, false);
  }
  const offline = createJevCanvasRouter({ env: {} });
  assert.equal((await offline.classify('Close the whiteboard.', boardContext)).shouldClose, false,'no keyword-based fallback close');
});

test('hidden boards, setup and new patches cannot trigger close', async () => {
  for (const context of [{ ...boardContext, boardVisible: false }, { ...boardContext, hasBoardUpdate: true }, { ...boardContext, phase: 'setup' }]) {
    let sent;
    const router = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only' }, fetchImpl: async (_, options) => { sent = JSON.parse(options.body); return visualResponse(.01, 1); } });
    assert.equal((await router.classify('Done.', context)).shouldClose, false);
    assert.equal(sent.questions.close_canvas, undefined);
  }
  const active = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only' }, fetchImpl: async () => visualResponse(.9, .02) });
  assert.equal((await active.classify('Now compare both columns.', boardContext)).shouldClose, false);
});

test('close context is bounded public dialogue with no private or tool records', async () => {
  let sent;
  const router = createJevCanvasRouter({ env: { TYPESAFE_API_KEY: 'test-only' }, fetchImpl: async (_, options) => { sent = JSON.parse(options.body); return visualResponse(.01, .1); } });
  await router.classify('Continue.', { ...boardContext, conversation: [...Array.from({length:20}, () => ({role:'user',content:'a'.repeat(2000),private:'SECRET'})),{role:'tool',content:'SECRET'}] });
  assert.equal(sent.state.context.conversation.length, 6);
  assert.ok(sent.state.context.conversation.every(item => item.content.length === 800));
  assert.ok(!JSON.stringify(sent).includes('SECRET'));
});

test('a hidden saved problem can reopen independently of a short spoken cue', async () => {
  let sent;
  const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'test-only'},fetchImpl:async(_,options)=>{
    sent=JSON.parse(options.body);
    return {ok:true,json:async()=>({answers:{needs_canvas:{type:'noul',noul:.2},reopen_canvas:{type:'noul',noul:.93}}})};
  }});
  const result=await router.classify('Which two cells are Nash equilibria?',{...boardContext,boardVisible:false});
  assert.equal(result.shouldReopen,true);
  assert.equal(result.reason,'resume-saved-visual');
  assert.equal(sent.questions.reopen_canvas.type,'noul');
  assert.equal(sent.questions.close_canvas,undefined);
  assert.match(sent.questions.reopen_canvas.instructions,/SAME concrete problem/);
});

test('unrelated, uncertain or unavailable saved-scene decisions do not reopen it',async()=>{
  for(const probability of [.01,.69,null]){
    const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'test-only'},fetchImpl:async()=>({ok:true,json:async()=>({answers:{needs_canvas:{type:'noul',noul:.95},reopen_canvas:{type:'noul',noul:probability}}})})});
    assert.equal((await router.classify('Explain a new topic.',{...boardContext,boardVisible:false})).shouldReopen,false);
  }
  assert.equal((await createJevCanvasRouter({env:{}}).classify('Show the matrix.',{...boardContext,boardVisible:false})).shouldReopen,false);
});

test('concrete topic switches can close an unrelated scene without an explicit finish phrase',async()=>{
  let sent;
  const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'test-only'},fetchImpl:async(_,options)=>{
    sent=JSON.parse(options.body);return visualResponse(.03,.96);
  }});
  const reply='What distinguishes active transport from diffusion?';
  const result=await router.classify(reply,{...boardContext,conversation:[{role:'user',content:'Let us study membranes next.'},{role:'assistant',content:reply}]});
  assert.equal(result.shouldClose,true);
  assert.match(sent.questions.close_canvas.instructions,/concretely switches to a different problem or topic not represented/);
  assert.match(sent.questions.close_canvas.instructions,/explicit completion phrase is not required/i);
  assert.match(sent.questions.close_canvas.instructions,/payoff matrix should close.*active transport/);
  assert.match(sent.questions.close_canvas.instructions,/another row.*same payoff game keeps its matrix visible/);
  assert.match(sent.questions.close_canvas.instructions,/logistical exchange alone.*exam date/);
});

test('an unrelated old scene closes even if the new problem needs a visual or its brief cue is uncertain',async()=>{
  for(const needs of [.5,.9]){
    const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'test-only'},fetchImpl:async()=>visualResponse(needs,.97)});
    const result=await router.classify('Which forces act on this block?',{...boardContext,conversation:[{role:'user',content:'Now a different force problem.'}]});
    assert.equal(result.shouldClose,true);assert.equal(result.source,'jev');
    assert.equal(result.needsCanvas,needs>=.6);
  }
});

const replacementResponse=(needs,replace)=>({ok:true,json:async()=>({answers:{needs_canvas:{type:'noul',noul:needs},replace_canvas:{type:'noul',noul:replace}}})});

test('new concrete visual problems can replace visible or hidden scenes independently of a brief cue',async()=>{
  for(const boardVisible of [true,false]){
    let sent;
    const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'test-only'},fetchImpl:async(_,options)=>{
      sent=JSON.parse(options.body);return replacementResponse(.5,.94);
    }});
    const reply='Which forces act on this block?\nWeight\nNormal force';
    const result=await router.classify(reply,{...boardContext,boardVisible,hasBoardUpdate:true,conversation:[{role:'user',content:'Next, a new force problem.'},{role:'assistant',content:reply}]});
    assert.equal(result.shouldReplace,true);assert.equal(result.replaceProbability,.94);assert.equal(result.source,'jev');
    assert.equal(result.reason,'different-visual-problem');
    assert.equal(result.shouldClose,false);assert.equal(result.shouldReopen,false);
    assert.equal(sent.questions.replace_canvas.type,'noul');
    assert.equal(sent.questions.close_canvas,undefined);assert.equal(sent.questions.reopen_canvas,undefined);
    assert.match(sent.questions.replace_canvas.instructions,/payoff game to a free-body diagram/);
    assert.match(sent.questions.replace_canvas.instructions,/adding an inequality about the selected row.*same game is a patch/);
    assert.match(sent.questions.replace_canvas.instructions,/even when that scene is hidden/);
  }
});

test('same-problem patches and uncertain or malformed replacement decisions preserve existing objects',async()=>{
  const context={...boardContext,hasBoardUpdate:true};
  for(const [probability,expected] of [[.02,false],[.69,false],[.7,true],[1,true],[null,false],['yes',false],[-.1,false],[1.1,false]]){
    const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'test-only'},fetchImpl:async()=>replacementResponse(.9,probability)});
    assert.equal((await router.classify('Compare the selected row.\n3>1',context)).shouldReplace,expected);
  }
  for(const fetchImpl of [
    async()=>response(.9),
    async()=>({ok:true,json:async()=>({answers:{needs_canvas:{type:'noul',noul:.9},replace_canvas:{type:'choice',noul:.99}}})}),
    async()=>{throw Error('offline');},
  ]){
    const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'test-only'},fetchImpl});
    assert.equal((await router.classify('A different exercise.\nx+2=7',context)).shouldReplace,false);
  }
  const uncertain=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'test-only'},fetchImpl:async()=>replacementResponse(.5,.5)});
  assert.equal((await uncertain.classify('Next step.',context)).shouldReplace,false);
  assert.equal((await createJevCanvasRouter({env:{}}).classify('A new problem.',context)).shouldReplace,false);
});

test('replacement is requested only for a proposed visual with an existing study scene',async()=>{
  for(const context of [
    {...boardContext,hasBoardUpdate:false},
    {...boardContext,hasBoardUpdate:true,existingBoard:null},
    {...boardContext,hasBoardUpdate:true,phase:'setup'},
    {...boardContext,hasBoardUpdate:true,existingBoard:{}},
  ]){
    let sent;
    const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'test-only'},fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return replacementResponse(.9,1);}});
    const result=await router.classify('New exercise.',context);
    assert.equal(sent.questions.replace_canvas,undefined);
    assert.equal(result.shouldReplace,false);
    assert.equal(result.replaceProbability,undefined);
  }
});

test('Jev can approve written teaching and independently close an unrelated board when text is declined',async()=>{
 let sent;
 const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'mock-only'},fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return{ok:true,json:async()=>({answers:{needs_canvas:{type:'noul',noul:.1},close_canvas:{type:'noul',noul:.95},replace_canvas:{type:'noul',noul:.9}}})};}});
 const result=await router.classify('Here is the definition.\nDiffusion is net movement down a concentration gradient.',{phase:'study',boardVisible:true,hasBoardUpdate:true,candidateTextOnly:true,existingBoard:{title:'Old equation',text:'x+2=5'}});
 assert.match(sent.questions.needs_canvas.instructions,/across all subjects/);
 assert.match(sent.questions.needs_canvas.instructions,/written definitions, concise notes, worked steps, or annotations/);
 assert.match(sent.questions.needs_canvas.instructions,/redundant spoken question or transcript wall/);
 assert.ok(sent.questions.close_canvas);assert.ok(sent.questions.replace_canvas);
 assert.equal(sent.state.context.candidateTextOnly,true);
 assert.equal(result.needsCanvas,false);assert.equal(result.shouldClose,true);
});

test('working problem relation is one public semantic dimension independent of uncertain canvas usefulness',async()=>{
 for(const [probability,expected]of [[.99,true],[.9,true],[.89,null],[.11,null],[.1,false],[0,false],[null,null]]){
  let sent,calls=0;const router=createJevCanvasRouter({env:{TYPESAFE_API_KEY:'mock'},fetchImpl:async(_url,request)=>{calls++;sent=JSON.parse(request.body);return{ok:true,json:async()=>({answers:{needs_canvas:{type:'noul',noul:.5},continues_working_problem:{type:'noul',noul:probability}}})};}});
  const result=await router.classify('What equal operation would you try first?',{phase:'study',workingProblem:{question:'How do equal operations solve 2x + 3 = 11?',answer:'PRIVATE'}});assert.equal(result.continuesWorkingProblem,expected);assert.equal(calls,1);assert.equal(JSON.stringify(sent).includes('PRIVATE'),false);assert.deepEqual(sent.state.context.workingProblem,{question:'How do equal operations solve 2x + 3 = 11?'});assert.ok(sent.questions.continues_working_problem);
 }
 assert.equal((await createJevCanvasRouter({env:{}}).classify('A question?',{phase:'study',workingProblem:{question:'Canonical?'}})).continuesWorkingProblem,null);
});
