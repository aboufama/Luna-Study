const reasons=new Set(['ready','no-question','not-ready','unconfirmed-problem','busy','cooldown','exhausted']);
export function receiveHintState(message,now=performance.now()){
  if(!message||!Number.isInteger(message.remaining)||message.remaining<0||message.remaining>3||!reasons.has(message.reason)||typeof message.available!=='boolean'||typeof message.busy!=='boolean'||typeof message.suggested!=='boolean'||!Number.isFinite(message.retryAfterMs)||message.retryAfterMs<0||message.retryAfterMs>45000||message.questionId!==null&&(typeof message.questionId!=='string'||!message.questionId||message.questionId.length>200))return null;
  return {questionId:message.questionId,remaining:message.remaining,available:message.available&&message.reason==='ready'&&!message.busy&&!!message.questionId&&message.remaining>0&&message.retryAfterMs===0,busy:message.busy,suggested:message.suggested,reason:message.reason,retryAt:now+message.retryAfterMs,receivedAt:now,pending:false};
}
export function hintView(state,{voiceState='idle',now=performance.now()}={}){
  const seconds=state?Math.max(0,Math.ceil((state.retryAt-now)/1000)):0;
  const available=Boolean(state?.available&&!state.pending&&!state.busy&&voiceState==='listening');
  const reason=!state?'No active question.':state.pending?'Requesting a hint.':voiceState==='idle'||voiceState==='paused'?'Resume the session to request a hint.':voiceState!=='listening'||state.busy?'Wait until Luna finishes.':state.reason==='no-question'?'No active question.':state.reason==='unconfirmed-problem'?'Luna needs to confirm the current problem first.':state.reason==='not-ready'?'The study session is not ready.':state.reason==='exhausted'?'All three hints have been used for this question.':state.reason==='cooldown'?'Wait for the hint cooldown to finish.':available?'Request a hint.':'A hint is not available yet.';
  return {available,seconds,remaining:state?.remaining??0,suggested:Boolean(state?.suggested&&state.questionId&&state.remaining>0),description:`${reason}${state?.questionId?` ${state.remaining} ${state.remaining===1?'hint remains':'hints remain'} for this question.`:''}`};
}
