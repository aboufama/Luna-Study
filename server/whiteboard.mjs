import { blockHasVisualContent } from '../shared/retained-scene.mjs';
import { randomUUID } from 'node:crypto';
import { validateBoard,validateStoredBoard,boardVisibleText } from './tutor-output.mjs';
import { resolvePart, resolvedZones } from '../shared/board-parts.mjs';

// Updates are patches by default. Only an explicit replace discards old objects.
export function applyBoardUpdate(current,update,{visualOnly=false}={}){
  const safe=validateBoard(update);if(!safe)return null;
  const previous=current?validateStoredBoard(current):null;if(current&&!previous)return null;
  const blocks=safe.mode==='replace'?[]:structuredClone(previous?.blocks||[]);
  const remove=new Set(safe.removedIds||[]);
  const retained=blocks.filter(block=>!remove.has(block.id));
  const updateIds=new Set(safe.blocks.flatMap(block=>block.id?[block.id]:[]));
  for(let index=0;index<safe.blocks.length;index++){
    let block=structuredClone(safe.blocks[index]);
    if(!block.id){let id=`legacy-${block.type}-${index}`,suffix=1;while(updateIds.has(id)||remove.has(id))id=`legacy-${block.type}-${index}-${suffix++}`;block.id=id;}
    updateIds.add(block.id);
    const existing=retained.findIndex(value=>value.id===block.id);
    if(block.type==='scene'){
      const prior=existing>=0?retained[existing]:null;
      if(block.removedObjectIds?.length&&(!prior||prior.type!=='scene'||block.removedObjectIds.some(id=>!prior.objects.some(object=>object.id===id))))return null;
      if(prior?.type==='scene'){
        if(prior.width!==block.width||prior.height!==block.height)return null;
        const removed=new Set(block.removedObjectIds||[]),objects=structuredClone(prior.objects).filter(object=>!removed.has(object.id));
        for(const object of block.objects){const at=objects.findIndex(value=>value.id===object.id);if(at<0)objects.push(object);else objects[at]=object;}
        block={...prior,...block,objects};
        if(!Object.hasOwn(safe.blocks[index],'zones')&&prior.zones)block.zones=prior.zones.filter(zone=>zone.anchor.kind!=='object'||!removed.has(zone.anchor.id));
      }
      delete block.removedObjectIds;
    }
    if(existing<0)retained.push(block);else retained[existing]=block;
  }
  const populated=retained.filter(block=>block.type!=='scene'||block.objects.length>0);
  const visible=visualOnly?populated.filter(blockHasVisualContent):populated;
  if(visualOnly&&!visible.length)return null;
  return validateStoredBoard({title:previous&&safe.mode!=='replace'?previous.title:safe.title,revision:randomUUID(),blocks:visible});
}

// Restored browser state gets a fresh server revision before any click is accepted.
export function restoreBoard(value,{visualOnly=false}={}){
  const safe=validateStoredBoard(value);
  if(safe){const populated=safe.blocks.filter(block=>block.type!=='scene'||block.objects.length>0),blocks=visualOnly?populated.filter(blockHasVisualContent):populated;return !blocks.length?null:{...safe,blocks,revision:randomUUID()};}
  const legacy=validateBoard(value);
  const restored=legacy?applyBoardUpdate(null,{...legacy,mode:'replace'},{visualOnly}):null;
  return restored?.blocks.length?restored:null;
}

export function resolveBoardSelection(board,event){
  const safe=validateStoredBoard(board);
  return safe?resolveSelection(safe,event):null;
}

function resolveSelection(safe,event){
  if(!event||typeof event!=='object'||Array.isArray(event)||event.boardRevision!==safe.revision)return null;
  if(Object.hasOwn(event,'type')&&event.type!=='canvas-select')return null;
  if(Object.hasOwn(event,'clear')){
    if(event.clear!==true||Object.keys(event).some(key=>!['type','boardRevision','clear'].includes(key)))return null;
    return {boardRevision:safe.revision,clear:true};
  }
  if(Object.hasOwn(event,'targets')){
    if(Object.keys(event).some(key=>!['type','boardRevision','targets'].includes(key))||!Array.isArray(event.targets)||event.targets.length>32)return null;
    if(!event.targets.length)return {boardRevision:safe.revision,clear:true};
    const seen=new Set(),targets=[];
    for(const identifier of event.targets){
      if(!identifier||typeof identifier!=='object'||Array.isArray(identifier)||Object.keys(identifier).length!==2||typeof identifier.blockId!=='string'||typeof identifier.zoneId!=='string'||Object.keys(identifier).some(key=>!['blockId','zoneId'].includes(key)))return null;
      const key=JSON.stringify([identifier.blockId,identifier.zoneId]);if(seen.has(key))return null;seen.add(key);
      const resolved=resolveSelection(safe,{boardRevision:safe.revision,...identifier});if(!resolved)return null;
      const {boardRevision,...target}=resolved;targets.push(target);
    }
    targets.sort((a,b)=>a.blockId<b.blockId?-1:a.blockId>b.blockId?1:a.zoneId<b.zoneId?-1:a.zoneId>b.zoneId?1:0);
    return {boardRevision:safe.revision,targets};
  }
  if(typeof event.blockId!=='string')return null;
  if(Object.keys(event).some(key=>!['type','boardRevision','blockId','elementIndex','cell','label','part','zoneId'].includes(key)))return null;
  if(Object.hasOwn(event,'part')&&(!Number.isInteger(event.part)||event.part<0))return null;
  const block=safe.blocks.find(value=>value.id===event.blockId);if(!block)return null;
  const base={boardRevision:safe.revision,blockId:block.id,type:block.type};
  if(Object.hasOwn(event,'zoneId')){
    if(typeof event.zoneId!=='string'||Object.keys(event).some(key=>!['type','boardRevision','blockId','zoneId'].includes(key)))return null;
    const zone=resolvedZones(block).find(zone=>zone.id===event.zoneId);if(!zone)return null;
    const {container,math,start,end,...target}=zone.target;
    return {...base,zoneId:zone.id,zoneLabel:zone.label,anchor:structuredClone(zone.anchor),...structuredClone(target)};
  }
  // Authored zones are the complete interaction policy for that block.
  if(Object.hasOwn(block,'zones'))return null;
  function withPart(selection,options){
    if(!Object.hasOwn(event,'part'))return selection;
    let part;
    try{part=resolvePart(selection.content,event.part,options);}catch{return null;}
    return part?{...selection,parentContent:selection.content,content:part.text,part}:null;
  }
  if(Object.hasOwn(event,'label')){
    const label=event.label;
    if(block.type!=='matrix'||Object.hasOwn(event,'cell')||Object.hasOwn(event,'elementIndex')||!label||typeof label!=='object'||Array.isArray(label)||Object.keys(label).some(key=>!['axis','index'].includes(key))||!['row','column'].includes(label.axis)||!Number.isInteger(label.index)||label.index<0)return null;
    const labels=label.axis==='row'?block.rowLabels:block.columnLabels;
    if(!labels||label.index>=labels.length)return null;
    return withPart({...base,label:{axis:label.axis,index:label.index},content:labels[label.index],...(block.label?{matrixLabel:block.label}:{})},{math:false});
  }
  if(Object.hasOwn(event,'cell')){
    const cell=event.cell;
    if(block.type!=='matrix'||Object.hasOwn(event,'elementIndex')||!cell||typeof cell!=='object'||Array.isArray(cell)||Object.keys(cell).some(key=>!['row','col'].includes(key))||!Number.isInteger(cell.row)||!Number.isInteger(cell.col)||cell.row<0||cell.col<0||cell.row>=block.rows.length||cell.col>=block.rows[0].length)return null;
    return withPart({...base,cell:{row:cell.row,col:cell.col},content:block.rows[cell.row][cell.col],...(block.label?{label:block.label}:{}),...(block.rowLabels?{rowLabel:block.rowLabels[cell.row]}:{}),...(block.columnLabels?{columnLabel:block.columnLabels[cell.col]}:{})},{math:true,inline:true});
  }
  if(Object.hasOwn(event,'elementIndex')){
    if(block.type!=='diagram'||!Number.isInteger(event.elementIndex)||event.elementIndex<0||event.elementIndex>=block.elements.length)return null;
    const element=block.elements[event.elementIndex];
    if(Object.hasOwn(event,'part')&&!element.text&&!element.label)return null;
    return withPart({...base,elementIndex:event.elementIndex,element:structuredClone(element),label:element.text||element.label||element.type,content:element.text||element.label||element.type},{math:false});
  }
  if(Object.hasOwn(event,'part')&&!['text','latex'].includes(block.type))return null;
  return withPart({...base,content:boardVisibleText({title:safe.title,revision:safe.revision,blocks:[block]})},{math:block.type==='latex',inline:false});
}

// Only identifiers cross back to the browser; canonical content stays server-side.
export function selectionIdentifier(selection){
  if(!selection||selection.clear)return null;
  if(Array.isArray(selection.targets))return selection.targets.length?{boardRevision:selection.boardRevision,targets:selection.targets.map(({blockId,zoneId})=>({blockId,zoneId}))}:null;
  if(selection.zoneId)return {boardRevision:selection.boardRevision,blockId:selection.blockId,zoneId:selection.zoneId};
  return {
    boardRevision:selection.boardRevision,blockId:selection.blockId,
    ...(selection.cell?{cell:{row:selection.cell.row,col:selection.cell.col}}:{}),
    ...(Number.isInteger(selection.elementIndex)?{elementIndex:selection.elementIndex}:{}),
    ...(selection.label&&typeof selection.label==='object'?{label:{axis:selection.label.axis,index:selection.label.index}}:{}),
    ...(selection.part!==undefined?{part:typeof selection.part==='number'?selection.part:selection.part.index}:{}),
  };
}

// Selection is a server-resolved target. Revalidate it, then preserve only when
// its entire underlying block is unchanged; a new revision alone is harmless.
export function rebaseBoardSelection(previous,next,selection){
  const before=validateStoredBoard(previous),after=validateStoredBoard(next);
  if(!before||!after||!selection)return null;
  const identifier=selectionIdentifier(selection),resolved=resolveBoardSelection(before,identifier);
  if(!resolved||resolved.clear)return null;
  function unchanged(target){
    const oldBlock=before.blocks.find(block=>block.id===target.blockId),newBlock=after.blocks.find(block=>block.id===target.blockId);
    if(!newBlock)return false;
    if(oldBlock.type==='scene'&&newBlock.type==='scene'&&target.zoneId){
      if(oldBlock.width!==newBlock.width||oldBlock.height!==newBlock.height)return false;
      const oldTarget=resolveSelection(before,{...target,boardRevision:before.revision}),newTarget=resolveSelection(after,{...target,boardRevision:after.revision});
      if(!oldTarget||!newTarget||oldTarget.anchor?.kind!=='object'||newTarget.anchor?.kind!=='object')return false;
      const {boardRevision:oldRevision,...oldValue}=oldTarget,{boardRevision:newRevision,...newValue}=newTarget;
      return JSON.stringify(oldValue)===JSON.stringify(newValue);
    }
    return JSON.stringify(oldBlock)===JSON.stringify(newBlock);
  }
  if(Array.isArray(resolved.targets)){
    const targets=identifier.targets.filter(unchanged);
    return targets.length?resolveSelection(after,{boardRevision:after.revision,targets}):null;
  }
  if(!unchanged(identifier))return null;
  return resolveBoardSelection(after,{...identifier,boardRevision:after.revision});
}
