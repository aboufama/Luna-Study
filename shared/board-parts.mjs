import { sceneObjectText } from './retained-scene.mjs';
import katex from 'katex';

const cache=new Map();
const escapeAttribute=value=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const decodeText=value=>value.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi,(_,numeric,named)=>{
  if(numeric){const n=numeric[0].toLowerCase()==='x'?parseInt(numeric.slice(1),16):Number(numeric);return n<=0x10ffff?String.fromCodePoint(n):'';}
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[named.toLowerCase()];
});

// Both sides derive the same ordinal targets from KaTeX's generated leaf spans.
// Only numeric IDs are sent by the browser; source text always comes from the scene.
export function renderSelectableMath(content,{inline=false}={}){
  const source=String(content).slice(0,4000),key=`${inline?'i':'d'}:${source}`;
  if(cache.has(key))return cache.get(key);
  const parts=[];
  let markup=katex.renderToString(source,{output:'html',displayMode:!inline,throwOnError:false,trust:false,strict:'ignore',maxExpand:500,maxSize:12,errorColor:'#666666'});
  markup=markup.replace('class="katex-html" aria-hidden="true"','class="katex-html"');
  markup=markup.replace(/<span\b([^<>]*)>([^<>]+)<\/span>/g,(whole,attributes,text)=>{
    const classes=attributes.match(/class="([^"]*)"/)?.[1]||'';
    if(!/(?:^|\s)(?:mord|mop|mbin|mrel|mopen|mclose|mpunct|delimsizing)(?:\s|$)/.test(classes)||parts.length>=512)return whole;
    const visible=decodeText(text).trim();if(!visible||!visible.replace(/[\u200b-\u200d]/g,''))return whole;
    const index=parts.length;parts.push({index,text:visible});
    return `<span${attributes} data-board-part="${index}" role="button" tabindex="0" aria-label="Select ${escapeAttribute(visible)}" aria-pressed="false">${text}</span>`;
  });
  const result={markup,parts};cache.set(key,result);if(cache.size>128)cache.delete(cache.keys().next().value);return result;
}

export function textParts(content){
  return [...String(content).matchAll(/\S+/gu)].slice(0,512).map((match,index)=>({index,text:match[0],start:match.index,end:match.index+match[0].length}));
}

export function resolvePart(content,index,{math=false,inline=false}={}){
  if(!Number.isInteger(index)||index<0)return null;
  const parts=math?renderSelectableMath(content,{inline}).parts:textParts(content),part=parts[index];
  if(!part)return null;
  return {index,text:part.text,nearby:parts.slice(Math.max(0,index-3),index+4).map(value=>value.text).join(' ')};
}

const own=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const zoneId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const zoneLabel=value=>typeof value==='string'&&value.trim().length>0&&value.length<=120&&!/[<>\u0000-\u001f]/.test(value);
const index=value=>Number.isInteger(value)&&value>=0;
const endsInControlWord=value=>{
  const match=value.match(/\\[A-Za-z]*$/);if(!match)return false;
  let slashes=1;for(let i=match.index-1;i>=0&&value[i]==='\\';i--)slashes++;
  return slashes%2===1;
};

// Anchors name authored source content, never renderer-dependent glyph ordinals.
export function zoneAnchorTarget(block,anchor){
  if(!own(anchor,['kind'],['row','col','index','id','quote','occurrence']))return null;
  let content,container,math=false,details={};
  if(anchor.kind!=='object'&&Object.hasOwn(anchor,'id'))return null;
  if(anchor.kind==='object'){
    if(block.type!=='scene'||!zoneId(anchor.id)||['row','col','index'].some(key=>Object.hasOwn(anchor,key)))return null;
    const object=block.objects.find(item=>item.id===anchor.id);if(!object)return null;
    content=sceneObjectText(object);container=`object:${object.id}`;math=object.type==='math';details={objectId:object.id,object};
    if(Object.hasOwn(anchor,'quote')&&!object.text&&!object.label)return null;
  }else if(anchor.kind==='content'){
    if(!['text','latex'].includes(block.type)||['row','col','index'].some(key=>Object.hasOwn(anchor,key)))return null;
    content=block.content;container='content';math=block.type==='latex';
  }else if(anchor.kind==='cell'){
    if(block.type!=='matrix'||!index(anchor.row)||!index(anchor.col)||Object.hasOwn(anchor,'index')||anchor.row>=block.rows.length||anchor.col>=block.rows[0].length)return null;
    content=block.rows[anchor.row][anchor.col];container=`cell:${anchor.row}:${anchor.col}`;math=true;details={cell:{row:anchor.row,col:anchor.col},rowLabel:block.rowLabels?.[anchor.row],columnLabel:block.columnLabels?.[anchor.col]};
  }else if(['row-label','column-label'].includes(anchor.kind)){
    if(block.type!=='matrix'||!index(anchor.index)||['row','col'].some(key=>Object.hasOwn(anchor,key)))return null;
    const axis=anchor.kind==='row-label'?'row':'column',labels=axis==='row'?block.rowLabels:block.columnLabels;
    if(!labels||anchor.index>=labels.length)return null;content=labels[anchor.index];container=`${anchor.kind}:${anchor.index}`;details={label:{axis,index:anchor.index}};
  }else if(anchor.kind==='element'){
    if(block.type!=='diagram'||!index(anchor.index)||anchor.index>=block.elements.length||['row','col'].some(key=>Object.hasOwn(anchor,key)))return null;
    const element=block.elements[anchor.index];content=element.text||element.label||element.type;container=`element:${anchor.index}`;details={elementIndex:anchor.index,element};
    if(Object.hasOwn(anchor,'quote')&&!element.text&&!element.label)return null;
  }else return null;
  if(typeof content!=='string')return null;
  let start=0,end=content.length;
  if(Object.hasOwn(anchor,'quote')){
    if(typeof anchor.quote!=='string'||!anchor.quote.trim()||anchor.quote.length>400||Object.hasOwn(anchor,'occurrence')&&(!index(anchor.occurrence)||anchor.occurrence>31))return null;
    let from=0;for(let occurrence=0;occurrence<=(anchor.occurrence||0);occurrence++){start=content.indexOf(anchor.quote,from);if(start<0)return null;from=start+anchor.quote.length;}end=start+anchor.quote.length;
    if(math){
      // A source range must not split a control word or an unbalanced group.
      if(endsInControlWord(content.slice(0,start))||endsInControlWord(content.slice(start,end))&&/[A-Za-z]/.test(content[end]||''))return null;
      let depth=0;for(let i=start;i<end;i++){if(content[i]==='\\'){i++;continue;}if(content[i]==='{')depth++;if(content[i]==='}'&&--depth<0)return null;}if(depth!==0)return null;
    }
  }else if(Object.hasOwn(anchor,'occurrence'))return null;
  return {container,math,start,end,content:content.slice(start,end),parentContent:content,...details};
}

export function validateInteractionZones(block){
  if(!Object.hasOwn(block,'zones'))return true;
  if(!Array.isArray(block.zones)||block.zones.length>16)return false;
  const ids=new Set(),targets=[];
  for(const zone of block.zones){
    if(!own(zone,['id','label','anchor'])||!zoneId(zone.id)||!zoneLabel(zone.label)||ids.has(zone.id))return false;
    const target=zoneAnchorTarget(block,zone.anchor);if(!target)return false;
    if(targets.some(other=>other.container===target.container&&other.start<target.end&&target.start<other.end))return false;
    ids.add(zone.id);targets.push({...target,zone});
  }
  const containers=new Set(targets.filter(target=>target.math).map(target=>target.container));
  for(const container of containers){
    const mathTargets=targets.filter(target=>target.container===container),zones=mathTargets.map(target=>({...target.zone,target}));
    try{const markup=renderZonedMath(mathTargets[0].parentContent,zones,{inline:block.type==='matrix'});if(!zones.every(zone=>markup.includes(`data-board-zone="${zone.id}"`)))return false;}catch{return false;}
  }
  return true;
}

const legacyCellCache=new Map();
// Compatibility for saved arrays: identify source cells, not KaTeX glyphs.
// Unsupported or ambiguous TeX stays one equation rather than guessed targets.
function legacyMathCellZones(content){
  if(legacyCellCache.has(content))return legacyCellCache.get(content);
  const remember=value=>{legacyCellCache.set(content,value);if(legacyCellCache.size>128)legacyCellCache.delete(legacyCellCache.keys().next().value);return value;};
  const beginnings=[...content.matchAll(/\\begin\{(array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix)\}/g)];
  if(beginnings.length!==1)return remember(null);
  const opening=beginnings[0],closing=`\\end{${opening[1]}}`,end=content.indexOf(closing,opening.index+opening[0].length);
  if(end<0||content.indexOf(closing,end+closing.length)>=0)return remember(null);
  let start=opening.index+opening[0].length;
  if(opening[1]==='array'){
    while(/\s/.test(content[start]||'')&&start<end)start++;
    if(content[start]!=='{')return remember(null);
    let depth=0;do{if(content[start]==='\\'){start+=2;continue;}if(content[start]==='{')depth++;if(content[start]==='}')depth--;start++;}while(start<end&&depth>0);
    if(depth!==0)return remember(null);
  }
  const body=content.slice(start,end);
  if(/\\(?:begin|end|multicolumn|multirow|omit|span|cr|newcommand|def)\b|%/.test(body))return remember(null);
  const rows=[[]];let depth=0,cellStart=start;
  const addCell=stop=>{
    const raw=content.slice(cellStart,stop);
    const leading=raw.match(/^(?:\s|\\(?:hline|toprule|midrule|bottomrule)\b|\\cline\{\d+-\d+\})*/)?.[0].length||0;
    const quote=raw.slice(leading).trimEnd();
    rows.at(-1).push({quote,start:cellStart+leading});
  };
  for(let i=start;i<end;i++){
    const char=content[i];
    if(char==='\\'){
      if(content[i+1]==='\\'&&depth===0){
        addCell(i);i++;rows.push([]);cellStart=i+1;
        // Optional row spacing belongs to the separator, never the next cell.
        const spacing=content.slice(cellStart,end).match(/^\s*\[[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:pt|em|ex|mu|cm|mm|in)\]/);
        if(spacing){i+=spacing[0].length;cellStart=i+1;}
        if(rows.length>10)return remember(null);
      }else i++;
      continue;
    }
    if(char==='{')depth++;
    if(char==='}'&&--depth<0)return remember(null);
    if(char==='&'&&depth===0){addCell(i);cellStart=i+1;if(rows.at(-1).length>=9)return remember(null);}
  }
  if(depth!==0)return remember(null);addCell(end);
  if(rows.at(-1).every(cell=>!cell.quote))rows.pop();
  if(!rows.length||rows.length>9||rows[0].length>9||rows.some(row=>row.length!==rows[0].length))return remember(null);
  const block={type:'latex',content},zones=[];
  for(const [r,row] of rows.entries())for(const [c,cell] of row.entries()){
    if(!cell.quote)continue;
    let from=0,occurrence=0,found;
    while((found=content.indexOf(cell.quote,from))>=0&&found<cell.start){from=found+cell.quote.length;occurrence++;}
    if(found!==cell.start||occurrence>31)return remember(null);
    const zone={id:`legacy-cell-${r}-${c}`,label:`Row ${r+1}, column ${c+1}`,anchor:{kind:'content',quote:cell.quote,occurrence}};
    const target=zoneAnchorTarget(block,zone.anchor);if(!target||target.start!==cell.start)return remember(null);
    zones.push({...zone,target});
  }
  if(!zones.length)return remember(null);
  try{const markup=renderZonedMath(content,zones);if(!zones.every(zone=>markup.includes(`data-board-zone="${zone.id}"`)))return remember(null);}catch{return remember(null);}
  return remember(zones.map(({target,...zone})=>zone));
}

export function interactionZones(block){
  if(!block||!validateInteractionZones(block))return [];
  if(Object.hasOwn(block,'zones'))return block.zones;
  // Legacy scenes remain useful, without making every word and glyph a button.
  if(block.type==='latex')return legacyMathCellZones(block.content)||[{id:'whole',label:'Select equation',anchor:{kind:'content'}}];
  if(block.type==='matrix')return [
    ...block.rows.flatMap((row,r)=>row.map((_,c)=>({id:`cell-${r}-${c}`,label:`${block.rowLabels?.[r]||`Row ${r+1}`}, ${block.columnLabels?.[c]||`column ${c+1}`}`,anchor:{kind:'cell',row:r,col:c}}))),
    ...(block.rowLabels||[]).map((label,i)=>({id:`row-${i}`,label,anchor:{kind:'row-label',index:i}})),
    ...(block.columnLabels||[]).map((label,i)=>({id:`column-${i}`,label,anchor:{kind:'column-label',index:i}})),
  ];
  if(block.type==='scene')return block.objects.map(object=>({id:object.id,label:sceneObjectText(object).slice(0,120),anchor:{kind:'object',id:object.id}}));
  if(block.type==='diagram')return block.elements.map((element,i)=>({id:`element-${i}`,label:element.label||element.text||`${element.type} ${i+1}`,anchor:{kind:'element',index:i}}));
  return [];
}
export function resolvedZones(block){return interactionZones(block).map(zone=>({...zone,target:zoneAnchorTarget(block,zone.anchor)})).filter(zone=>zone.target);}

export function renderZonedMath(content,zones,{inline=false}={}){
  const source=String(content).slice(0,4000);let annotated=source;
  const authorizedIds=new Set(zones.map(zone=>zone.id));
  // Source-authored HTML commands never gain trust from generated wrappers.
  const allowWrappers=!/\\(?:html\w*|href|url|includegraphics)\b/i.test(source);
  if(!allowWrappers)zones=[];
  for(const zone of [...zones].sort((a,b)=>b.target.start-a.target.start)){
    const {start,end}=zone.target;if(!zoneId(zone.id)||start<0||end>source.length||end<=start)continue;
    annotated=annotated.slice(0,start)+`\\htmlData{board-zone=${zone.id}}{${annotated.slice(start,end)}}`+annotated.slice(end);
  }
  let markup=katex.renderToString(annotated,{output:'html',displayMode:!inline,throwOnError:false,trust:context=>allowWrappers&&context.command==='\\htmlData'&&Object.entries(context.attributes||{}).every(([key,value])=>(key==='data-board-zone'||key==='board-zone')&&authorizedIds.has(value)),strict:'ignore',maxExpand:500,maxSize:12,errorColor:'#666666'});
  // Invalid fragment boundaries can be mathematically safe yet not parsable.
  // Render the unchanged source without targets instead of showing added markup.
  if(markup.includes('class="katex-error"'))markup=katex.renderToString(source,{output:'html',displayMode:!inline,throwOnError:false,trust:false,strict:'ignore',maxExpand:500,maxSize:12,errorColor:'#666666'});
  return markup.replace('class="katex-html" aria-hidden="true"','class="katex-html"');
}
