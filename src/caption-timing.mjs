import { normalizeSpeechAlignment } from '../shared/speech-alignment.mjs';

// Whole, fit-bounded phrases for film-style captions. Offsets remain relative to
// the original spoken text, so wrapping never advances the playback position.
export function captionCues(text,maxChars=76){
  const limit=Math.max(32,Math.min(120,Number(maxChars)||76)), cues=[];
  let start=0;
  while(start<text.length){
    while(/\s/u.test(text[start]||'')&&start<text.length)start++;
    if(start===text.length)break;
    let end=Math.min(text.length,start+limit);
    if(end<text.length){const space=text.lastIndexOf(' ',end);end=space>start?space:(text.indexOf(' ',end)===-1?text.length:text.indexOf(' ',end));}
    const part=text.slice(start,end), punctuation=[...part.matchAll(/[.!?;,:](?=\s|$)/gu)];
    const stop=punctuation.find(match=>match.index>=Math.min(20,limit*.35));
    if(stop)end=start+stop.index+1;
    const value=text.slice(start,end).trimEnd();
    if(value)cues.push({text:value,start,end:start+value.length});
    start=end;
  }
  return cues;
}

// Caption clocks count consumed PCM, never wall time or model token arrival.
// Missing timestamps use a bounded estimate: 12 characters/second while audio
// streams, then remaining words over remaining PCM once its full length is
// known. This cannot prove word accuracy. A final packet never advances text.
export function createCaptionTimeline({maxChars=76}={}) {
  let transcript='',segments=[],total=0,played=0,shown='',ended=false;
  let alignedText='',alignedEnds=[],alignedStarts=[],allAligned=true,finalizedEstimate=null;
  let estimateChars=0,lastPhrase='',reflow=false;
  function setText(text){if(typeof text==='string')transcript=text.slice(0,1800);}
  function setMaxChars(value){maxChars=Math.max(32,Math.min(120,Number(value)||76));reflow=true;}
  function addAudio({start,duration,alignment}){
    if(!Number.isFinite(start)||!Number.isFinite(duration)||duration<=0)return;
    const safe=normalizeSpeechAlignment(alignment,duration*1000);
    segments.push({start,duration,offset:total});
    if(safe){
      for(let i=0;i<safe.chars.length;i++)for(const char of safe.chars[i]){
        alignedText+=char;
        // JS slicing uses UTF-16 offsets, including surrogate pairs.
        for(let unit=0;unit<char.length;unit++){
          alignedStarts.push(total+safe.startsMs[i]/1000);
          alignedEnds.push(total+Math.min(duration,(safe.startsMs[i]+safe.durationsMs[i])/1000));
        }
      }
    }else allAligned=false;
    total+=duration;
  }
  function finish(){
    if(ended)return;ended=true;
    const remaining=Math.max(0,total-played);
    finalizedEstimate=remaining>.08?{base:played,chars:Math.max(shown.length,estimateChars),duration:remaining}:null;
  }
  function prefixAt(text,limit,complete){
    if(complete)return text.trim();
    let end=0;
    for(const match of text.matchAll(/\S+\s*/gu)){
      const wordEnd=match.index+match[0].trimEnd().length;
      if(wordEnd>limit)break;
      if(wordEnd===text.length&&!ended)break;
      end=wordEnd;
    }
    return text.slice(0,end).trim();
  }
  function tick(contextTime){
    if(!Number.isFinite(contextTime))return null;
    const consumed=segments.reduce((sum,segment)=>sum+Math.max(0,Math.min(segment.duration,contextTime-segment.start)),0);
    if(consumed<=played+1e-7&&!reflow)return null;
    reflow=false;played=Math.min(total,consumed);
    if(played<=0)return null;
    const complete=ended&&total>0&&played>=total-1e-6;
    let candidate,timing,cursor,available;
    if(allAligned&&alignedText){
      let limit=0;while(limit<alignedEnds.length&&alignedEnds[limit]<=played+1e-7)limit++;
      candidate=prefixAt(alignedText,limit,complete);timing='provider';
      cursor=0;while(cursor<alignedStarts.length&&alignedStarts[cursor]<=played+1e-7)cursor++;
      available=transcript.startsWith(alignedText)?transcript:alignedText;
    }else{
      // Never swap already shown provider-normalized words for mismatching text.
      if(shown&&!transcript.startsWith(shown))return null;
      if(finalizedEstimate){
        const p=Math.max(0,Math.min(1,(played-finalizedEstimate.base)/finalizedEstimate.duration));
        estimateChars=finalizedEstimate.chars+(transcript.length-finalizedEstimate.chars)*p;
      }else estimateChars=Math.max(estimateChars,played*12);
      cursor=Math.min(estimateChars,Math.max(0,transcript.length-1));
      candidate=prefixAt(transcript,cursor,complete&&Boolean(finalizedEstimate));timing='estimated';available=transcript;
    }
    const cue=captionCues(available,maxChars).filter(item=>item.start<cursor).at(-1)||null;
    const phrase=cue?.text||'';
    if(candidate.length<shown.length||(candidate===shown&&phrase===lastPhrase))return null;
    shown=candidate;lastPhrase=phrase;return {text:shown,phrase,cue,timing,final:complete};
  }
  return {setText,setMaxChars,addAudio,finish,tick,get complete(){return ended&&total>0&&played>=total-1e-6;},get playedSeconds(){return played;}};
}
