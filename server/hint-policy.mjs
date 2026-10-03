import {createHash,randomUUID} from 'node:crypto';
import {questionKey} from './mastery.mjs';

const MAX_HINTS=3,COOLDOWN_MS=45_000,PERMIT_TTL_MS=120_000;
const storeState=new WeakMap();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bounded=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const validScope=value=>value&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.testId||'')&&bounded(value.sourceRevision,128);
const questionIdentity=question=>question&&bounded(question.id,128)&&bounded(question.topicId,128)&&bounded(question.question,400)&&Array.isArray(question.sourceIds)&&question.sourceIds.length>0&&question.sourceIds.every(id=>bounded(id,128))?
  hash({questionKey:questionKey(question),sourceIds:[...question.sourceIds].sort()}):null;

/** Process-local retention deliberately survives voice reconnects, not a server
 * restart. A bounded TTL/LRU keeps old tests from accumulating indefinitely. */
export function createHintPolicyStore({now=Date.now,ttlMs=24*60*60_000,maxEntries=512}={}){
  if(typeof now!=='function')throw Error('Invalid hint policy clock.');
  const store=Object.freeze({});
  storeState.set(store,{now,ttlMs:Number.isFinite(ttlMs)?Math.max(1,ttlMs):24*60*60_000,maxEntries:Number.isInteger(maxEntries)?Math.max(1,Math.min(10_000,maxEntries)):512,records:new Map(),aliases:new Map(),permits:new WeakMap()});
  return store;
}
const sharedStore=createHintPolicyStore();

export const isHintRequest=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&value.type==='hint');

// This event comes from an opaque server permit, never a synthetic student
// message. Keep the action distinct from the conversation it follows.
export function hintTurnTask(context){
  if(context?.hintAllowed!==true)return undefined;
  const levelGoal={orientation:'Focus attention on one relevant given or relationship; do not prescribe the solution method yet.',strategy:'Name a useful method and why it applies, without executing the complete solution.','next-step':'Give one concrete step from the last work the student actually supplied, or from the original givens if they have supplied no step. Earlier hints are proposals, not completed student work.'}[context.hintLevel];
  return {kind:'deliver-authorized-hint',questionId:context.questionId,hintNumber:context.hintNumber,hintLevel:context.hintLevel,
    levelGoal,
    instruction:'The student clicked Hint NOW. Deliver this granted hint for the working problem at levelGoal. Earlier conversation has already been answered: do not repeat its last reply. Never give the final answer or assume the learner completed an earlier suggested step. This grant remains valid even when no later hints remain. Then invite one student step; do not advertise another hint during cooldown.'};
}

// These responses contain no academic content, so a request to bypass the
// button never starts an unconstrained answer/hint generation by itself.
export function hintRequestReply(state){
  if(state?.reason==='no-question')return "Let's choose a question first.";
  if(state?.reason==='unconfirmed-problem')return 'Let me confirm the current problem before we use a hint.';
  if(state?.reason==='not-ready')return 'Once the material is ready, we can start a question.';
  if(state?.reason==='exhausted')return "You've used the three hints for this question. Try a complete answer; then we can review it.";
  if(state?.reason==='cooldown')return 'Try one step first. The Hint button will be ready shortly.';
  if(state?.reason==='busy')return "Let's finish this turn first; then you can use the Hint button.";
  return 'Use the Hint button for a nudge, or tell me your first step.';
}

export function createHintPolicy({store=sharedStore}={}){
  const state=storeState.get(store);if(!state)throw Error('Invalid hint policy store.');
  const owner=Symbol('voice-session');let scope=null,active=null,activeQuestionId=null,currentPermit=null;
  function clock(){const value=state.now();if(!Number.isFinite(value))throw Error('Invalid hint policy time.');return value;}
  function invalidate(ticket){ticket.status='canceled';if(ticket.record.pending===ticket)ticket.record.pending=null;}
  function removeRecord(key){
    const record=state.records.get(key);if(!record)return;
    if(record.pending)invalidate(record.pending);
    for(const alias of record.aliases)state.aliases.delete(alias);
    state.records.delete(key);
  }
  function prune(now){
    for(const [key,record]of state.records){
      if(record.pending&&now>=record.pending.expiresAt)invalidate(record.pending);
      if(now-record.touched>=state.ttlMs)removeRecord(key);
    }
  }
  function recordFor(question,create=false){
    const identity=questionIdentity(question);if(!scope||!identity)return null;
    const now=clock();prune(now);
    const alias=hash([scope.testId,scope.sourceRevision,question.id]);
    const key=hash([scope.testId,scope.sourceRevision,identity]),known=state.aliases.get(alias);
    if(known&&known!==key)return null; // A reused public ID cannot change its target.
    if(!create&&!known)return null; // Only activated, server-known aliases authorize review.
    let record=state.records.get(key);
    if(!record&&create){
      record={key,identity,aliases:new Set(),used:0,cooldownUntil:0,meaningfulAttempt:false,pending:null,touched:now};state.records.set(key,record);
      while(state.records.size>state.maxEntries)removeRecord(state.records.keys().next().value);
    }
    if(record){
      record.touched=now;state.records.delete(key);state.records.set(key,record);
      state.aliases.delete(alias);state.aliases.set(alias,key);record.aliases.add(alias);
      // Bank IDs may regenerate for the same target; bound their guard table
      // separately without deleting the retained quota/exposure for that target.
      while(state.aliases.size>state.maxEntries*4){const oldest=state.aliases.keys().next().value;state.records.get(state.aliases.get(oldest))?.aliases.delete(oldest);state.aliases.delete(oldest);}
    }
    return record;
  }
  function activeRecord(){
    prune(clock());
    if(!active||state.records.get(active.key)!==active){active=null;return null;}
    active.touched=clock();return active;
  }
  function ticketFor(permit){
    if(!permit||typeof permit!=='object')return null;
    const ticket=state.permits.get(permit),record=activeRecord();
    return ticket&&ticket.owner===owner&&ticket.record===record&&record?.pending===ticket&&ticket.status!=='canceled'?ticket:null;
  }
  function cancel(permit){
    const ticket=permit&&typeof permit==='object'?state.permits.get(permit):null;
    if(!ticket||ticket.owner!==owner||ticket.status==='canceled')return false;
    invalidate(ticket);if(currentPermit===permit)currentPermit=null;return true;
  }
  function status({ready=true,busy=false,suggested=false}={}){
    const record=activeRecord(),pending=record?.pending;
    const remaining=record?Math.max(0,MAX_HINTS-record.used-(pending?.status==='reserved'?1:0)):0;
    const retryAfterMs=record?Math.max(0,Math.ceil(record.cooldownUntil-clock())):0;
    const isBusy=busy===true||Boolean(pending);
    const reason=!record?'no-question':ready!==true?'not-ready':isBusy?'busy':remaining===0?'exhausted':retryAfterMs>0?'cooldown':'ready';
    return {questionId:record?activeQuestionId:null,remaining,cooldownUntil:retryAfterMs>0?record.cooldownUntil:null,retryAfterMs,available:reason==='ready',busy:isBusy,suggested:suggested===true&&Boolean(record),reason};
  }
  function context(permit){
    const record=activeRecord(),ticket=ticketFor(permit),allowed=Boolean(ticket);
    // A reserved hint is still owed to this turn. The button status subtracts
    // the reservation, but that future availability must not cancel the grant.
    const remaining=record?Math.max(0,MAX_HINTS-record.used):0;
    const ordinal=allowed?ticket.permit.ordinal:null;
    const button=status();
    return {questionId:record?activeQuestionId:null,maxHints:MAX_HINTS,hintsUsed:record?.used||0,hintsRemaining:remaining,hintAllowed:allowed,hintNumber:ordinal,hintLevel:ordinal?['orientation','strategy','next-step'][ordinal-1]:null,hintAvailable:button.available,retryAfterMs:button.retryAfterMs,allowAnswerReview:record?.meaningfulAttempt===true,requiresAttempt:!allowed&&Boolean(record)&&!record.meaningfulAttempt&&remaining===0};
  }
  return {
    setScope(value){
      const next=validScope(value)?{testId:value.testId.toLowerCase(),sourceRevision:value.sourceRevision}:null;
      if(JSON.stringify(next)===JSON.stringify(scope))return Boolean(next);
      cancel(currentPermit);scope=next;active=null;activeQuestionId=null;return Boolean(next);
    },
    activate(question){
      const next=question?recordFor(question,true):null;
      if(next!==active||question?.id!==activeQuestionId)cancel(currentPermit);
      active=next;activeQuestionId=next?question.id:null;return status();
    },
    status,context,
    deliveredHints(question){return recordFor(question)?.used||0;},
    reserve(options={}){
      const before=status(options);if(!before.available)return {allowed:false,permit:null,state:before};
      const record=activeRecord(),permit=Object.freeze({id:randomUUID(),questionId:activeQuestionId,ordinal:record.used+1});
      const ticket={permit,record,owner,status:'reserved',expiresAt:clock()+PERMIT_TTL_MS};
      record.pending=ticket;state.permits.set(permit,ticket);currentPermit=permit;
      return {allowed:true,permit,state:status(options)};
    },
    commit(permit){
      const ticket=ticketFor(permit);if(!ticket)return false;
      if(ticket.status==='committed')return true;
      ticket.record.used++;ticket.record.cooldownUntil=clock()+COOLDOWN_MS;ticket.record.touched=clock();ticket.status='committed';
      return true;
    },
    cancel,
    markAttempt(question,result){
      // Partial work can earn its normal score and local feedback without
      // granting the final worked solution. In particular a generic principle
      // or scaffold response must not bypass the bounded Hint permission.
      if(result?.checked!==true||!['correct','incorrect'].includes(result.verdict))return false;
      const record=recordFor(question);if(!record)return false;record.meaningfulAttempt=true;return true;
    },
    maskBank(bank){
      if(!bank||typeof bank!=='object')return bank;
      const copy=structuredClone(bank);
      for(const topic of Array.isArray(copy.topics)?copy.topics:[])for(const question of Array.isArray(topic?.questions)?topic.questions:[]){
        if(question&&typeof question==='object'&&!recordFor(question)?.meaningfulAttempt)delete question.answer;
      }
      return copy;
    },
    reset(){cancel(currentPermit);scope=null;active=null;activeQuestionId=null;},
  };
}
