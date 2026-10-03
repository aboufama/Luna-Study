/** Public question history only. Reference answers and unasked bank entries
 * never enter this state; correctness comes only from independently checked grades. */
export function createPracticeTrail({limit=12}={}){
  const entries=new Map();let currentId=null;
  function publicQuestion(question){
    if(!question||typeof question.id!=='string'||!question.id||typeof question.question!=='string'||!question.question.trim())return null;
    return {questionId:question.id,question:question.question,topicTitle:typeof question.topicTitle==='string'?question.topicTitle:'',attempts:0,assisted:false,status:'current'};
  }
  return {
    sync(active){
      const next=publicQuestion(active?.question),previous=entries.get(currentId);
      // Only leaving an unattempted question sets it aside. Restating or
      // revisiting it makes it current without changing any checked outcome.
      if(previous&&previous.questionId!==next?.questionId&&previous.status==='current')previous.status='set-aside';
      currentId=next?.questionId||null;
      if(next){const prior=entries.get(next.questionId),status=prior?.status==='set-aside'?'current':prior?.status||'current';entries.set(next.questionId,{...next,...prior,status,attempts:Math.max(prior?.attempts||0,Number.isInteger(active.attempts)?active.attempts:0),assisted:active.assisted===true||prior?.assisted===true});}
      while(entries.size>limit)entries.delete(entries.keys().next().value);
      return this.snapshot();
    },
    attempted(questionId){const item=entries.get(questionId);if(item){item.attempts++;if(item.status!=='completed')item.status='attempted';}return this.snapshot();},
    checked(questionId,grade){const item=entries.get(questionId);if(item&&grade?.checked===true&&['correct','partial','incorrect'].includes(grade.verdict))item.status=grade.verdict==='correct'?'completed':'reviewed';return this.snapshot();},
    snapshot(){const current=entries.get(currentId);return {current:current?{...current}:null,recent:[...entries.values()].filter(item=>item.questionId!==currentId).map(item=>({...item}))};},
    clear(){entries.clear();currentId=null;return this.snapshot();},
  };
}
