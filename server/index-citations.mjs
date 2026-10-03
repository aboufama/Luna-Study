import {createHash} from 'node:crypto';

const MAX_EXCERPT_CHARS=600,MIN_EXCERPT_CHARS=256;
const splitsPair=(text,end)=>end>0&&end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]);

// Balance the complete readable region rather than leaving a tiny final span.
// A boundary preference never removes whitespace or rewrites mathematical text.
function readableRanges(text,start,end){
  const length=end-start;
  if(length<=MAX_EXCERPT_CHARS)return [{start,end}];
  for(let count=Math.ceil(length/MAX_EXCERPT_CHARS);count<=Math.floor(length/MIN_EXCERPT_CHARS);count++){
    const ranges=[];let at=start;
    for(let remaining=count;remaining>0;remaining--){
      if(remaining===1){ranges.push({start:at,end});at=end;break;}
      const min=at+Math.max(MIN_EXCERPT_CHARS,end-at-(remaining-1)*MAX_EXCERPT_CHARS);
      const max=at+Math.min(MAX_EXCERPT_CHARS,end-at-(remaining-1)*MIN_EXCERPT_CHARS);
      const target=at+Math.ceil((end-at)/remaining);
      let boundary=null;
      // Keep nearby line/word boundaries, but avoid very uneven partitions.
      for(const expression of [/\n/,/\s/]){
        let distance=Infinity;
        for(let candidate=Math.max(min,target-64);candidate<=Math.min(max,target+64);candidate++){
          if(expression.test(text[candidate-1])&&!splitsPair(text,candidate)&&Math.abs(candidate-target)<distance){boundary=candidate;distance=Math.abs(candidate-target);}
        }
        if(boundary!==null)break;
      }
      if(boundary===null){
        boundary=Math.max(min,Math.min(max,target));
        if(splitsPair(text,boundary))boundary=boundary-1>=min?boundary-1:boundary+1<=max?boundary+1:null;
      }
      if(boundary===null)break;
      ranges.push({start:at,end:boundary});at=boundary;
    }
    if(at===end)return ranges;
  }
  throw new Error('Unable to partition original indexing evidence.');
}

export function buildIndexCitations(chunk){
  if(!chunk||typeof chunk.chunkId!=='string'||typeof chunk.text!=='string'||!chunk.text.trim())throw new Error('Indexing requires a readable original chunk.');
  const text=chunk.text,readableStart=text.length-text.trimStart().length,readableEnd=text.trimEnd().length;
  const ranges=[];
  const whitespace=(start,end)=>{for(let at=start;at<end;at+=MAX_EXCERPT_CHARS)ranges.push({start:at,end:Math.min(end,at+MAX_EXCERPT_CHARS)});};
  whitespace(0,readableStart);
  ranges.push(...readableRanges(text,readableStart,readableEnd));
  whitespace(readableEnd,text.length);
  const identity=createHash('sha256').update(JSON.stringify([chunk.chunkId,chunk.sourceId,chunk.start,chunk.end,text])).digest('hex').slice(0,24);
  return Object.freeze(ranges.map(({start,end})=>Object.freeze({id:`e-${identity}-${start}-${end}`,start,end,text:text.slice(start,end)})));
}

export function selectableIndexCitations(catalog){return catalog.filter(excerpt=>excerpt.text.trim());}
