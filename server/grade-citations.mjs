import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
export const imageSourceHash=id=>typeof id==='string'&&/^img-[a-f0-9]{64}$/.test(id)?id.slice(4):null;

// The upload store verifies these content-addressed IDs against original bytes
// within the current test. The organizer must attach those pixels on each call.
const imageEvidence=id=>Object.freeze({id:`image:${id}`,type:'image',sourceId:id,sha256:imageSourceHash(id)});
export const sourceCitationIds=catalog=>catalog.materials.flatMap(source=>source.imageEvidence?[source.imageEvidence.id]:source.excerpts.filter(item=>item.text.trim()).map(item=>item.id));
export const assistanceCitationIds=catalog=>(catalog.assistanceEvidence||[]).filter(turn=>turn.assistanceEligible).flatMap(turn=>turn.excerpts.filter(item=>item.text.trim()).map(item=>item.id));

// Complete, lossless partitions of original evidence. No paraphrasing, fuzzy
// matching, relevance truncation or client-authored citation identities.
function excerpts(text,prefix,limit){
  const result=[];
  for(let start=0;start<text.length;){
    let end=Math.min(start+limit,text.length);
    if(end<text.length){
      const boundary=text.lastIndexOf('\n',end-1),space=text.lastIndexOf(' ',end-1);
      if(boundary>start+limit/2)end=boundary+1;else if(space>start+limit/2)end=space+1;
      // Never split a UTF-16 surrogate pair.
      const unit=text.charCodeAt(end-1);if(unit>=0xD800&&unit<=0xDBFF)end--;
    }
    result.push(Object.freeze({id:`${prefix}-${result.length}`,text:text.slice(start,end)}));start=end;
  }
  return Object.freeze(result);
}

export function buildGradeCitations(question,answer,materials,conversation=[]){
  if(!Array.isArray(question?.sourceIds)||!question.sourceIds.length||new Set(question.sourceIds).size!==question.sourceIds.length||typeof answer!=='string'||!Array.isArray(materials))return null;
  const answerExcerpts=excerpts(answer,`a-${hash(answer)}`,1000);
  const sources=question.sourceIds.map(id=>{
    const source=materials.find(item=>item.id===id);
    if(!source||typeof source.text!=='string'||!source.text.trim())return null;
    if(typeof id==='string'&&id.startsWith('img-')){
      if(!imageSourceHash(id))return null;
      // Derived transcription/description aids navigation, but is never minted
      // into a textual citation that could stand in for the original pixels.
      return Object.freeze({id,name:source.name||id,excerpts:Object.freeze([]),derivedText:source.text,textOrigin:'derived-image-text',imageEvidence:imageEvidence(id)});
    }
    return source&&typeof source.text==='string'?Object.freeze({id:source.id,name:source.name||source.id,excerpts:excerpts(source.text,`s-${hash(`${source.id}\0${source.text}`)}`,1800)}):null;
  });
  if(!answerExcerpts.some(item=>item.text.trim())||sources.some(source=>!source||!source.imageEvidence&&!source.excerpts.some(item=>item.text.trim())))return null;
  const assistanceEvidence=Array.isArray(conversation)?conversation.flatMap((turn,turnIndex)=>{
    if(turn?.role!=='assistant'||typeof turn.content!=='string'||!turn.content.trim())return[];
    const id=`h-${hash(`${turnIndex}\0${turn.content}`)}`;
    return[Object.freeze({id,turnIndex,assistanceEligible:turn.content!==question.question,excerpts:excerpts(turn.content,id,1000)})];
  }):[];
  return Object.freeze({answerExcerpts,materials:Object.freeze(sources),assistanceEvidence:Object.freeze(assistanceEvidence)});
}

export function resolveGradeCitations(value,catalog,{targetReview=false,assistanceReview=Object.hasOwn(value||{},'assistanceCitationIds')}={}){
  const fields=['questionId','topicId','sourceIds','verdict','reasoningSufficient','assistanceUsed','answerCitationIds','sourceCitationIds',...(targetReview?['targetAttempt']:[]),...(assistanceReview?['assistanceCitationIds']:[])];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(value,key)))return{grade:null,reason:'invalid-citation-response'};
  const answers=new Map(catalog.answerExcerpts.map(item=>[item.id,item.text]));
  const sources=new Map(catalog.materials.flatMap(source=>source.imageEvidence?[[source.imageEvidence.id,{type:'image',sourceId:source.id,sha256:source.imageEvidence.sha256}]]:source.excerpts.map(item=>[item.id,{sourceId:source.id,quote:item.text}])));
  const valid=(ids,map,max)=>Array.isArray(ids)&&ids.length>0&&ids.length<=max&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&map.has(id));
  if(!valid(value.answerCitationIds,answers,4))return{grade:null,reason:'answer-citation-mismatch'};
  if(!valid(value.sourceCitationIds,sources,100))return{grade:null,reason:'source-citation-mismatch'};
  const assistant=new Map((catalog.assistanceEvidence||[]).filter(turn=>turn.assistanceEligible).flatMap(turn=>turn.excerpts.map(item=>[item.id,{id:item.id,turnIndex:turn.turnIndex,turnId:turn.id,quote:item.text}])));
  if(assistanceReview&&(typeof value.assistanceUsed!=='boolean'||!Array.isArray(value.assistanceCitationIds)||(value.assistanceUsed?!valid(value.assistanceCitationIds,assistant,4):value.assistanceCitationIds.length!==0)))return{grade:null,reason:'assistance-citation-mismatch'};
  const {answerCitationIds,sourceCitationIds,assistanceCitationIds:helpIds,...metadata}=value;
  const evidence=sourceCitationIds.map(id=>({...sources.get(id)})),sourceImages=evidence.filter(item=>item.type==='image');
  return{grade:{...metadata,answerQuotes:answerCitationIds.map(id=>answers.get(id)),sourceQuotes:evidence.filter(item=>item.type!=='image'),...(sourceImages.length?{sourceImages}:{}),...(assistanceReview?{assistanceEvidence:helpIds.map(id=>({...assistant.get(id)}))}:{})},reason:null};
}
