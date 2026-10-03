import {hintTurnTask} from './hint-policy.mjs';

// Current control events are separate from accumulated dialogue. This carries
// public input and server permissions only; it never invents a student turn or
// asks the tutor to decide its own scoring/Hint authorization.
export function tutorTurnTask({hintContext,studentIntent,readinessContext,text}={}){
  const hint=hintTurnTask(hintContext);
  if(hint)return hint;
  if(readinessContext?.ready!==true||typeof text!=='string'||!text.trim())return undefined;
  return {kind:'respond-to-student',latestStudentMessage:text,
    reviewQuestionId:hintContext?.questionId||null,
    allowWorkedReview:Boolean(hintContext?.questionId)&&hintContext?.allowAnswerReview===true&&studentIntent?.requestsHelp===true,
    instruction:'Respond to this current message. When restating a question, use only its original givens and requested task. Do not add definitions, comparison criteria or operations that the question asks the learner to discover. If it submits academic work, assess this submission only. For a wrong or incomplete answer, identify one discrepancy and invite the learner to repair it; do not supply the completed target or worked solution unless allowWorkedReview is true. That permission applies only to reviewQuestionId, never a different or unattempted problem. For a correct answer, briefly affirm and lead to a concrete next practice question or teach-back. Use an exact <ask> ID for scored practice, including revisits. Avoid readiness checks and topic menus. Honor logistics, refusal and pauses without forcing practice.'};
}
