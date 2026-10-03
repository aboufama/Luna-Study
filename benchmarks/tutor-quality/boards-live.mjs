// Twenty paid calls maximum: ten matched before/after public board scenarios.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createOpenAILuna} from '../../server/openai-luna.mjs';
import {lunaInstructions} from '../../server/luna-fast.mjs';
import {applyBoardUpdate} from '../../server/whiteboard.mjs';
import {boardVisibleText} from '../../server/tutor-output.mjs';
import {withProviderSlot} from '../whiteboard-provider-slot.mjs';
import {boardScenarios} from './board-scenarios.mjs';
if(!process.argv.includes('--live'))throw Error('Use --live for the bounded model comparison.');
const final=process.argv.includes('--final');
const diagnostic=process.argv.includes('--diagnostic'),repair=final||process.argv.includes('--repair')||diagnostic;
const dir=new URL('./',import.meta.url),baseline=await readFile(new URL('before-instructions.txt',dir),'utf8'),current=lunaInstructions();
const sha=s=>createHash('sha256').update(s).digest('hex');
const report={startedAt:new Date().toISOString(),maximumPaidRequests:final||diagnostic?4:repair?8:20,paidRequests:0,model:'gpt-5.6-terra',method:'Ten public teaching scenarios, matched input and same Terra model/low reasoning. Alternating before/current order. Latency is production streaming adapter through validated board completion, excluding provider lock. No STT/TTS in this arm; visual quality is separately inspected from actual browser renders. All failed outputs retained.',instructions:{before:{chars:baseline.length,sha256:sha(baseline)},current:{chars:current.length,sha256:sha(current)}},runs:[]};
if(repair)report.method='Targeted follow-up after manual review exposed wrong axis labels, overlapping connector labels and duplicated grammar text. Six subject scenarios plus repeat math/grammar, eight calls maximum, same Terra model. Added semantic plots and exact phrase annotations; preserved the original 20-call comparison unchanged. All outputs retained.';
if(final)report.method='Four fresh follow-up calls after nested annotations, table prose and flow connector fixes, with optional shape-preserving smooth plots. Public fixtures unchanged; preserves prior failed cohorts. Not a paired latency comparison.';
if(diagnostic)report.method='Four fresh grammar calls capturing raw public output to diagnose validation failures; preserves rejected output. Not a paired latency comparison.';
await mkdir(dir,{recursive:true});
const save=()=>writeFile(new URL(final?'boards-final-results.json':diagnostic?'boards-diagnostic-results.json':repair?'boards-repaired-results.json':'boards-results.json',dir),JSON.stringify(report,null,2)+'\n');
const repairScenarios=[...boardScenarios.filter(s=>['biology-process','programming-branch','grammar-annotation','math-parabola'].includes(s.id)),{id:'math-negative-slope',request:'Graph these supplied demand points accurately with numerical axes, x for quantity and y for price. Use the provided values and no invented labels.',source:'The demand line has price P=10-2Q. Quantity Q ranges from0to5. Supplied points(Q,P)are(0,10),(1,8),(2,6),(3,4),(4,2),(5,0). The vertical axis is Price, the horizontal axis Quantity.'},{id:'literature-annotation',request:'Show which words form the central metaphor and who its subject is. Put the original sentence on the board once with the annotations underneath.',source:'In the fictional sentence “Her memory was a locked garden.”, the subject is “Her memory” and “a locked garden” is the metaphorical image. This is figurative language, not a claim about a physical garden.'}];
const scenarios=final?boardScenarios.filter(s=>['hydraulic-legend','programming-branch','grammar-annotation','math-parabola'].includes(s.id)):diagnostic?Array.from({length:4},(_,i)=>({...boardScenarios.find(s=>s.id==='grammar-annotation'),id:'grammar-annotation-diagnostic-'+(i+1)})):repair?[...repairScenarios,...repairScenarios.filter(s=>['math-parabola','grammar-annotation'].includes(s.id)).map(s=>({...s,id:s.id+'-repeat'}))]:boardScenarios;
for(const [index,scenario] of scenarios.entries())for(const condition of repair?['current']:index%2?['current','before']:['before','current'])await withProviderSlot(async()=>{
 const run={id:scenario.id+'-'+condition,scenario:scenario.id,condition,source:scenario.source,request:scenario.request,latencies:{},status:'pending'};
 report.runs.push(run);let start;
 const fetchImpl=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.ok(report.paidRequests<report.maximumPaidRequests);report.paidRequests++;
  const payload=JSON.parse(options.body);payload.instructions=condition==='before'?baseline:current;run.inputCharacters=typeof payload.input==='string'?payload.input.length:JSON.stringify(payload.input).length;
  const response=await fetch(url,{...options,body:JSON.stringify(payload)});
  if(!response.body)return response;
  let buffer='',decoder=new TextDecoder();run.raw='';
  return new Response(response.body.pipeThrough(new TransformStream({transform(chunk,controller){buffer+=decoder.decode(chunk,{stream:true});let boundary;while((boundary=/\r?\n\r?\n/.exec(buffer))){const frame=buffer.slice(0,boundary.index);buffer=buffer.slice(boundary.index+boundary[0].length);for(const line of frame.split(/\r?\n/))if(line.startsWith('data: ')){try{const event=JSON.parse(line.slice(6));if(event.type==='response.output_text.delta')run.raw=(run.raw+event.delta).slice(0,14000);}catch{}}}controller.enqueue(chunk)}})),{status:response.status,headers:response.headers});
 };
 const tutor=createOpenAILuna({env:{...process.env,LUNA_TUTOR_MODEL:'gpt-5.6-terra'},fetchImpl});
 try{
  const input={title:'Visual teaching quality',date:'2026-10-10',indexStatus:'ready',readinessContext:{ready:true,trigger:'student-turn'},materials:[{id:'source-'+scenario.id,name:'Public scenario',text:scenario.source}],conversation:[{role:'user',content:scenario.request}]};
  start=performance.now();
  const result=await tutor.respond(input,{effort:'low',timeoutMs:60000,onText:()=>{run.latencies.firstTextMs??=Math.round(performance.now()-start);},onSpeechEnd:()=>{run.latencies.speechCompleteMs??=Math.round(performance.now()-start);},onUsage:value=>{run.usage=value;}});
  run.result=result;run.board=result.board?applyBoardUpdate(null,result.board):null;run.latencies.completeMs=Math.round(performance.now()-start);run.visibleText=run.board?boardVisibleText(run.board):'';
  run.status=run.board?'valid-board':'no-board';run.checks={validBoard:Boolean(run.board),speech:Boolean(result.reply),noExecutableMarkup:!/<(?:script|iframe|img)\b/i.test(run.visibleText)};
 }catch(error){run.status='failed';run.error={status:error.status||error.providerStatus||null,message:String(error.message).slice(0,180)};}
 finally{await tutor.close();await save();}
 console.log(JSON.stringify({id:run.id,status:run.status,latencies:run.latencies,blocks:run.board?.blocks.map(b=>b.type),paidRequests:report.paidRequests}));
});
report.finishedAt=new Date().toISOString();await save();
