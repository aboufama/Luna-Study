import { renderZonedMath } from './board-parts.mjs';

/** Only explicit math delimiters are interpreted. Ordinary text, currency and
 * HTML remain literal; rendering never evaluates source-authored markup. */
export function boardTextParts(value) {
  const text=String(value||''),parts=[];
  const matches=/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|(?<![\\$])\$(?![\s$])([^\n$]+?)\$(?!\$)/g;
  let cursor=0;
  for(const match of text.matchAll(matches)){
    let slashes=0;for(let p=match.index-1;p>=0&&text[p]==='\\';p--)slashes++;
    if(slashes%2)continue;
    const content=match[1]??match[2]??match[3];
    if(!content.trim()||match[3]!==undefined&&/^\s*[\d,.]+\s*$/.test(content))continue;
    if(match.index>cursor)parts.push({type:'text',text:text.slice(cursor,match.index)});
    parts.push({type:'math',text:content,display:match[2]!==undefined});cursor=match.index+match[0].length;
  }
  if(cursor<text.length)parts.push({type:'text',text:text.slice(cursor)});
  return parts;
}

export function renderBoardInlineMath(content,{display=false}={}) {
  return renderZonedMath(content,[],{inline:!display});
}

/** Legacy matrices contain both formulas and prose. Explicit math keeps its
 * semantics; bare prose must retain spaces rather than become TeX variables. */
export function matrixCellIsMath(value){
  const content=String(value||'');
  if(boardTextParts(content).some(part=>part.type==='math'))return false;
  if(/\\[A-Za-z]+/.test(content))return true;
  return !/\p{L}{2,}/u.test(content)&&content.trim().length>0;
}

// Prose columns need readable word widths on narrow screens. Explicitly
// delimited formulas do not turn an otherwise numeric grid into a prose table.
export function matrixProseColumns(rows){
  return (rows[0]||[]).map((_,column)=>rows.some(row=>!matrixCellIsMath(row[column])&&boardTextParts(row[column]).some(part=>part.type==='text'&&/\p{L}{2,}/u.test(part.text))));
}
