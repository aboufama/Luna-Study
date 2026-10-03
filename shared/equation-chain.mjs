// Retain exact source slices; only add visual wrap opportunities at a
// top-level implication arrow. Never rewrite TeX or split nested constructs.
const arrows=new Set(['to','rightarrow','longrightarrow','Rightarrow','Longrightarrow','leftrightarrow','Leftrightarrow','Longleftrightarrow','xrightarrow','xleftarrow','implies']);
export function equationChainParts(content){
  if(typeof content!=='string')return [];
  if(/\\(?:begin|end|left|right|not|newline|tag|over|atop|above|overwithdelims|atopwithdelims|abovewithdelims|choose|brace|brack|bgroup|egroup|begingroup|endgroup|def|gdef|edef|xdef|let|newcommand|renewcommand|color|colorlet|displaystyle|textstyle|scriptstyle|scriptscriptstyle|rm|bf|it|cal|tt|sf|tiny|small|large|Large|huge|Huge)\b|\\\\/.test(content))return [content];
  let depth=0;const breaks=[];
  for(let i=0;i<content.length;i++){
    const c=content[i];
    if(c==='\\'){
      const command=/^\\([A-Za-z]+)/.exec(content.slice(i));
      if(command){if(depth===0&&arrows.has(command[1])&&content.slice(0,i).trim())breaks.push(i);i+=command[0].length-1;}
      else i++; // Escaped braces and symbols cannot alter group depth.
    }else if(c==='{')depth++;
    else if(c==='}') {if(--depth<0)return [content];}
  }
  if(depth!==0||!breaks.length||breaks.length>12)return [content];
  const points=[0,...breaks,content.length],parts=points.slice(0,-1).map((start,i)=>content.slice(start,points[i+1]));
  return parts.every(part=>part.trim())?parts:[content];
}
