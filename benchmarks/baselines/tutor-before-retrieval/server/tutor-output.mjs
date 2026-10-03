import { validateInteractionZones } from '../shared/board-parts.mjs';
const keys=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const safeText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/<\/?[a-z][^>]*>/i.test(value)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const coordinate=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;

export const validBoardId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const safeLatex=(value,max,empty=false)=>(empty&&value===''||safeText(value,max))&&!/\\(?:html\w*|href|url|includegraphics|input|write|def|newcommand|require)\b/i.test(value);

function validateScene(value,stored=false){
  const required=stored?['title','blocks','revision']:['title','blocks'];
  const optional=stored?[]:['mode','removedIds'];
  if(!keys(value,required,optional)||!safeText(value.title,120)||!Array.isArray(value.blocks)||value.blocks.length>(stored?12:6))return null;
  if(stored&&!validBoardId(value.revision))return null;
  if(!stored&&Object.hasOwn(value,'mode')&&!['patch','replace'].includes(value.mode))return null;
  if(!stored&&Object.hasOwn(value,'removedIds')&&(!Array.isArray(value.removedIds)||value.removedIds.length>12||!value.removedIds.every(validBoardId)||new Set(value.removedIds).size!==value.removedIds.length))return null;
  if(!value.blocks.length&&!stored&&value.mode!=='replace'&&!value.removedIds?.length)return null;
  try{if(JSON.stringify(value).length>(stored?24000:12000))return null;}catch{return null;}
  let primitives=0;const ids=new Set();
  for(const block of value.blocks){
    if(!block||Object.hasOwn(block,'id')&&!validBoardId(block.id)||stored&&!Object.hasOwn(block,'id'))return null;
    if(block.id){if(ids.has(block.id)||value.removedIds?.includes(block.id))return null;ids.add(block.id);}
    if(block.type==='text'||block.type==='latex'){
      if(!keys(block,['type','content'],['id','zones'])||!safeText(block.content,4000))return null;
      if(block.type==='latex'&&!safeLatex(block.content,4000))return null;
    }else if(block.type==='matrix'){
      if(!keys(block,['type','rows'],['id','rowLabels','columnLabels','label','zones'])||!Array.isArray(block.rows)||!block.rows.length||block.rows.length>12)return null;
      const columns=block.rows[0]?.length;
      if(!Array.isArray(block.rows[0])||!columns||columns>12||!block.rows.every(row=>Array.isArray(row)&&row.length===columns&&row.every(cell=>typeof cell==='string'&&cell.length<=160&&safeLatex(cell,160,true))))return null;
      if(Object.hasOwn(block,'rowLabels')&&(!Array.isArray(block.rowLabels)||block.rowLabels.length!==block.rows.length||!block.rowLabels.every(label=>safeText(label,120))))return null;
      if(Object.hasOwn(block,'columnLabels')&&(!Array.isArray(block.columnLabels)||block.columnLabels.length!==columns||!block.columnLabels.every(label=>safeText(label,120))))return null;
      if(Object.hasOwn(block,'label')&&!safeText(block.label,120))return null;
    }else if(block.type==='diagram'){
      if(!keys(block,['type','elements'],['id','zones'])||!Array.isArray(block.elements)||!block.elements.length)return null;
      primitives+=block.elements.length;if(primitives>30)return null;
      for(const item of block.elements){
        if(item?.type==='line'||item?.type==='arrow'){
          if(!keys(item,['type','x1','y1','x2','y2'])||!['x1','y1','x2','y2'].every(key=>coordinate(item[key])))return null;
        }else if(item?.type==='rect'){
          if(!keys(item,['type','x','y','width','height'],['label'])||!['x','y','width','height'].every(key=>coordinate(item[key]))||item.width<=0||item.height<=0||item.x+item.width>100||item.y+item.height>100||Object.hasOwn(item,'label')&&!safeText(item.label,120))return null;
        }else if(item?.type==='circle'){
          if(!keys(item,['type','x','y','r'],['label'])||!['x','y','r'].every(key=>coordinate(item[key]))||item.r<=0||item.x-item.r<0||item.y-item.r<0||item.x+item.r>100||item.y+item.r>100||Object.hasOwn(item,'label')&&!safeText(item.label,120))return null;
        }else if(item?.type==='text'){
          if(!keys(item,['type','x','y','text'])||!coordinate(item.x)||!coordinate(item.y)||!safeText(item.text,200))return null;
        }else return null;
      }
    }else return null;
    if(!validateInteractionZones(block))return null;
  }
  return JSON.parse(JSON.stringify(value));
}
export const validateBoard=value=>validateScene(value);
export const validateStoredBoard=value=>validateScene(value,true);

export function boardVisibleText(board){
  const safe=Object.hasOwn(board||{},'revision')?validateStoredBoard(board):validateBoard(board);if(!safe)return '';
  return safe.blocks.flatMap(block=>{
    if(block.type==='diagram')return block.elements.map(item=>item.type==='text'?item.text:item.label||'');
    if(block.type==='matrix')return [block.label||'',block.columnLabels?.join(' | ')||'',...block.rows.map((row,index)=>[block.rowLabels?.[index],...row].filter(value=>value!==undefined).join(' | '))];
    return [block.content];
  }).filter(Boolean).join('\n');
}

// Small streaming decoder. Buffer tag prefixes across arbitrary token/chunk
// boundaries; JSON is collected only inside <board> and never reaches speech.
export function createTutorOutput({onText,onSpeechEnd,includeBoardStatus=false,maxOutputChars=14000,maxSpokenChars=1800}={}){
  let mode='prefix',buffer='',spoken='',total=0,boardText='',board=null,boardStatus='none',boardRepair=null,finished=false;
  const tags=['<say>','</say>','<board>','</board>'];
  function speak(value){if(!value)return;if(spoken.length+value.length>maxSpokenChars)throw Error('Spoken reply is too long.');spoken+=value;onText?.(value);}
  function captureBoard(){try{board=validateBoard(JSON.parse(boardText));}catch{board=null;}boardStatus=board?'valid':'invalid';boardText='';}
  function process(final=false){
    // A provider-completed response may omit only the closing protocol tag.
    // Accept its body only if it is already complete JSON passing every scene
    // constraint. Never repair truncated JSON, braces, strings, or schema errors.
    if(final&&mode==='board'){
      try { const complete=validateBoard(JSON.parse(boardText+buffer));if(complete){board=complete;boardStatus='valid';boardRepair='missing-close-tag';} } catch { /* Incomplete or malformed content stays rejected. */ }
      buffer='';boardText='';return;
    }
    if(mode==='prefix'){
      buffer=buffer.trimStart();if(!buffer)return;
      if(buffer.startsWith('<')){if(tags.some(tag=>tag.startsWith(buffer.toLowerCase()))&&!final)return;mode='outside';}
      else if(buffer.startsWith('{')||buffer.startsWith('['))mode='discard';
      else mode='legacy';
    }
    while(buffer){
      if(mode==='discard'){buffer='';return;}
      if(mode==='board'){
        const combined=boardText+buffer;let end=-1,inString=false,escaped=false;
        for(let i=0;i<combined.length;i++){
          const char=combined[i];
          if(inString){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false;}
          else if(char==='"')inString=true;
          else if(combined.slice(i,i+8).toLowerCase()==='</board>'){end=i;break;}
        }
        if(end>=0){boardText=combined.slice(0,end);buffer=combined.slice(end+8);captureBoard();mode='outside';continue;}
        if(final){buffer='';boardText='';return;}
        boardText=combined;buffer='';return;
      }
      const index=buffer.indexOf('<');
      if(index<0){if(mode==='say'||mode==='legacy')speak(buffer);buffer='';return;}
      if(index>0){if(mode==='say'||mode==='legacy')speak(buffer.slice(0,index));buffer=buffer.slice(index);}
      const lower=buffer.toLowerCase(),tag=tags.find(item=>lower.startsWith(item));
      if(tag){buffer=buffer.slice(tag.length);if(tag==='<board>'){boardText='';boardStatus='incomplete';mode='board';}else if(tag==='<say>')mode='say';else {const endedSpeech=tag==='</say>'&&mode==='say';if(tag==='</board>')boardStatus='invalid';mode='outside';if(endedSpeech)onSpeechEnd?.();}continue;}
      if(tags.some(item=>item.startsWith(lower))){if(final){if(lower.startsWith('<b')||lower.startsWith('</b'))boardStatus='incomplete';buffer='';}return;}
      // A malformed board tag must never downgrade its JSON to legacy speech.
      if(lower.startsWith('<board')||lower.startsWith('</board')){boardStatus='invalid';mode='discard';buffer='';return;}
      if(mode==='outside'){mode='discard';buffer='';return;}
      // Ordinary spoken legacy text may contain a literal inequality sign.
      speak('<');buffer=buffer.slice(1);
    }
  }
  return {
    push(delta){if(finished)throw Error('Tutor output already completed.');if(typeof delta!=='string')throw Error('Invalid tutor output.');total+=delta.length;if(total>maxOutputChars)throw Error('Tutor output is too long.');buffer+=delta;process();},
    finish(){if(!finished){process(true);boardText='';buffer='';finished=true;}return {reply:spoken.trim(),...(board?{board}:{}),...(includeBoardStatus?{boardStatus:board?'valid':boardStatus,...(boardRepair?{boardRepair}:{})}:{})};},
    get spoken(){return spoken;},
  };
}
