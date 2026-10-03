// Bounded real semantic classifier study. Synthetic public study context only.
// node --env-file-if-exists=.env benchmarks/jev-board-intent.mjs --live
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createJevIntentRouter} from '../server/jev-intent.mjs';
import {withProviderSlot} from './whiteboard-provider-slot.mjs';
import {estimateUsage} from '../server/usage-pricing.mjs';
import {tokenUsage} from '../server/usage-ledger.mjs';
const subjects=[
 {id:'biology',board:{title:'Animal cell',text:'Cell membrane: selective boundary. Cytoplasm surrounds the nucleus.'},question:'What does the cell membrane do?',answer:'The membrane controls which substances cross the boundary.',other:'Put the cell diagram away. Let us switch to the French Revolution.',same:'Can you give me a hint about the membrane on this diagram?'},
 {id:'algebra',board:{title:'Solve an equation',text:'2x + 3 = 11\n2x = 8\nx = 4'},question:'Why subtract three from both sides?',answer:'Subtracting the same amount preserves equality and isolates 2x.',other:'We are done with this equation. Switch to identifying clauses in a sentence.',same:'The second line on this board should be 2x = 8. Please correct that same example.'},
 {id:'history',board:{title:'French Revolution timeline',text:'1789: Storming of the Bastille. 1792: First French Republic declared.'},question:'Which timeline event happened in 1789?',answer:'The Storming of the Bastille happened in 1789.',other:'Leave this timeline. I want to study how a cell membrane works now.',same:'Help me understand the first event on this timeline.'},
 {id:'grammar',board:{title:'Sentence clauses',text:'Although it was raining, Maya walked to class.\nAlthough it was raining: dependent clause.\nMaya walked to class: main clause.'},question:'Which clause is dependent?',answer:'Although it was raining is the dependent clause.',other:'We have finished this sentence. Move to the force balance on a block.',same:'Keep the same sentence, but fix the underline so it covers the entire dependent clause.'},
];
const cases=subjects.flatMap(s=>[
 {id:`${s.id}-different-topic`,subject:s.id,text:s.other,expectedClose:true,context:{previousAssistant:s.question,activeQuestion:s.question,existingBoard:s.board}},
 {id:`${s.id}-verbal-detour`,subject:s.id,text:'Hide the board for now; I want a short verbal overview of how to plan this week’s revision instead.',expectedClose:true,context:{previousAssistant:s.question,activeQuestion:s.question,existingBoard:s.board}},
 {id:`${s.id}-answer`,subject:s.id,text:s.answer,expectedClose:false,context:{previousAssistant:s.question,activeQuestion:s.question,existingBoard:s.board}},
 {id:`${s.id}-same-problem`,subject:s.id,text:s.same,expectedClose:false,context:{previousAssistant:s.question,activeQuestion:s.question,existingBoard:s.board}},
 {id:`${s.id}-vague`,subject:s.id,text:'What about this one?',expectedClose:false,context:{previousAssistant:s.question,activeQuestion:s.question,existingBoard:s.board}},
]);
const extended=process.argv.includes('--missing-active-question');
const missing=subjects.flatMap(s=>[
 {id:`${s.id}-untracked-switch`,subject:s.id,text:s.other,expectedClose:true,context:{previousAssistant:'We were discussing the displayed example.',existingBoard:s.board}},
 {id:`${s.id}-untracked-answer`,subject:s.id,text:s.answer,expectedClose:false,context:{previousAssistant:'What do you notice about the displayed example?',existingBoard:s.board}},
 {id:`${s.id}-untracked-help`,subject:s.id,text:s.same,expectedClose:false,context:{previousAssistant:'We were discussing the displayed example.',existingBoard:s.board}},
]);
const plan=extended?[...cases.filter(c=>/-vague$|-answer$|-same-problem$/.test(c.id)),...missing]:[...cases,...cases.filter(c=>c.id.endsWith('-vague')).map(c=>({...c,id:`${c.id}-repeat`}))];
const live=process.argv.includes('--live');
const output=new URL(live?extended?'./jev-board-intent-results.final.json':'./jev-board-intent-results.json':'./jev-board-intent-results.offline.json',import.meta.url);
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const report={startedAt:new Date().toISOString(),live,maximumRequests:24,requestCount:0,threshold:.9,timeoutMs:850,scope:`Same production student-intent call, extra optional should_close_board question only for current visible board. Synthetic public contexts; no tutor, speech or grading calls. ${extended?'12 previous keep cases plus12 cases with no activeQuestion, including explicit switches, related answers and help/corrections.':'20 unique cases and4 vague-reference repeats.'} Predetermined expectations; not production percentiles.`,sourceSha256:hash(await readFile(new URL('../server/jev-intent.mjs',import.meta.url))),runs:[]};
if(live&&!process.env.TYPESAFE_API_KEY?.trim())throw Error('Missing classifier configuration');
for(const item of plan){
  const record={...item},captures=[];
  const router=createJevIntentRouter({env:live?process.env:{TYPESAFE_API_KEY:'offline-fixture'},timeoutMs:850,fetchImpl:async(url,options)=>{
    if(url!=='https://api.typesafe.ai/v1/systemone')throw Error('Unexpected provider endpoint');
    if(report.requestCount>=24)throw Error('Request ceiling');report.requestCount++;
    record.request=JSON.parse(options.body);
    if(!live)return{ok:true,json:async()=>({answers:{requests_help:{type:'noul',noul:.01},answer_attempt:{type:'noul',noul:.01},exam_deadline:{type:'noul',noul:.01},should_close_board:{type:'noul',noul:item.expectedClose?.99:.01}}})};
    const response=await fetch(url,options);record.httpStatus=response.status;
    if(response.ok)captures.push(response.clone().json().then(body=>{record.provider={answers:body.answers,usage:body.usage,model:typeof body.model==='string'?body.model:undefined};},()=>{}));
    return response;
  }});
  const run=async()=>{const started=performance.now();record.decision=await router.classify(item.text,item.context);record.latencyMs=Math.round((performance.now()-started)*10)/10;await Promise.allSettled(captures);};
  if(live)await withProviderSlot(run);else await run();
  record.correct=(record.decision.shouldCloseBoard===true)===item.expectedClose;
  record.estimatedCost=record.provider?.usage?estimateUsage({provider:'typesafe',model:record.provider.model||record.request.model,status:'completed',units:tokenUsage(record.provider.usage)}):null;
  report.runs.push(record);await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({id:item.id,expectedClose:item.expectedClose,decision:record.decision,latencyMs:record.latencyMs,correct:record.correct,count:report.requestCount}));
}
const ordered=report.runs.map(r=>r.latencyMs).sort((a,b)=>a-b);
report.finishedAt=new Date().toISOString();
report.summary={correct:report.runs.filter(r=>r.correct).length,total:report.runs.length,expectedClose:report.runs.filter(r=>r.expectedClose).length,expectedKeep:report.runs.filter(r=>!r.expectedClose).length,falseHides:report.runs.filter(r=>!r.expectedClose&&r.decision.shouldCloseBoard===true).length,missedHides:report.runs.filter(r=>r.expectedClose&&r.decision.shouldCloseBoard!==true).length,unavailable:report.runs.filter(r=>r.decision.source!=='jev').length,medianMs:(ordered[11]+ordered[12])/2,minMs:ordered[0],maxMs:ordered.at(-1),inputTokens:report.runs.reduce((n,r)=>n+(r.provider?.usage?.input_tokens||0),0),outputTokens:report.runs.reduce((n,r)=>n+(r.provider?.usage?.output_tokens||0),0),estimatedUsd:report.runs.reduce((n,r)=>n+(r.estimatedCost?.usd||0),0),unpricedRequests:report.runs.filter(r=>!r.estimatedCost).length,exactBilledUsd:null};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
