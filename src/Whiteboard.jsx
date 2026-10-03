import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { resolvedZones, renderZonedMath } from '../shared/board-parts.mjs';
import 'katex/dist/katex.min.css';
import './whiteboard-selection.css';
import { selectionContours } from './selection-contour.mjs';
import TeachingScene from './TeachingScene.jsx';
import BoardRichText from './BoardRichText.jsx';
import { matrixCellIsMath, matrixProseColumns } from '../shared/board-rich-text.mjs';
import './board-reading.css';
import { layoutFlow } from '../shared/flow-layout.mjs';
import { TeachingPlot, TeachingAnnotation } from './TeachingLayouts.jsx';
import { equationChainParts } from '../shared/equation-chain.mjs';

const targetKey=target=>`${target.blockId}:${target.zoneId}`;
const selectionTargets=selection=>Array.isArray(selection?.targets)?selection.targets:selection?.blockId&&selection?.zoneId?[selection]:[];
const sortedTargets=targets=>[...new Map(targets.map(({blockId,zoneId})=>[`${blockId}:${zoneId}`,{blockId,zoneId}])).values()].sort((a,b)=>a.blockId.localeCompare(b.blockId)||a.zoneId.localeCompare(b.zoneId)).slice(0,32);
const selectedFor=(selection,blockId)=>new Set(selectionTargets(selection).filter(target=>target.blockId===blockId).map(target=>target.zoneId));
function activate(event,action){if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();action();}}
function nearestZone(surface,event){
  let closest=null,best=Infinity;
  for(const element of surface.querySelectorAll('[data-board-zone]'))for(const rect of element.getClientRects()){
    if(!rect.width||!rect.height)continue;
    const dx=Math.max(rect.left-event.clientX,0,event.clientX-rect.right),dy=Math.max(rect.top-event.clientY,0,event.clientY-rect.bottom),distance=Math.hypot(dx,dy);
    const score=distance+Math.hypot(event.clientX-(rect.left+rect.width/2),event.clientY-(rect.top+rect.height/2))*.025;
    if(distance<=((event.pointerType||event.nativeEvent?.pointerType)==='touch'?20:12)&&score<best){best=score;closest=element;}
  }
  return closest;
}
function nearClick(event,blockId,onSelect){
  if(event.target.closest('[data-board-zone]'))return;
  const target=nearestZone(event.currentTarget,event);if(target){event.stopPropagation();onSelect({blockId,zoneId:target.dataset.boardZone});}
}
function TextContent({content,zones,selectedZones,onZone,svg=false}){
  if(!svg&&!zones.length)return <BoardRichText text={content}/>;
  const Tag=svg?'tspan':'span';let cursor=0;
  const pieces=[...zones].sort((a,b)=>a.target.start-b.target.start).map(zone=>{
    const {start,end}=zone.target,space=content.slice(cursor,start);cursor=end;
    return <React.Fragment key={zone.id}>{space}<Tag data-board-zone={zone.id} role="button" tabIndex={0} aria-label={zone.label} aria-pressed={selectedZones.has(zone.id)} onClick={event=>{event.stopPropagation();onZone(zone.id);}} onKeyDown={event=>activate(event,()=>onZone(zone.id))}>{content.slice(start,end)}</Tag></React.Fragment>;
  });
  return <>{pieces}{content.slice(cursor)}</>;
}
function MathContent({content,zones,inline=false,selectedZones,onZone}){
  const ref=useRef(null),zoneSignature=JSON.stringify(zones),markup=useMemo(()=>{
    const parts=!inline&&!zones.length?equationChainParts(content):[content];
    if(parts.length<2)return renderZonedMath(content,zones,{inline});
    return `<span class="board-equation-chain">${parts.map(part=>`<span class="board-equation-step">${renderZonedMath(part,[],{inline:false})}</span>`).join('')}</span>`;
  },[content,zoneSignature,inline]);
  useEffect(()=>{for(const element of ref.current.querySelectorAll('[data-board-zone]')){const zone=zones.find(zone=>zone.id===element.dataset.boardZone);if(!zone)continue;element.setAttribute('role','button');element.setAttribute('tabindex','0');element.setAttribute('aria-label',zone.label);element.setAttribute('aria-pressed',String(selectedZones.has(zone.id)));}},[markup,zones,selectedZones]);
  const target=event=>{const element=event.target.closest('[data-board-zone]');return element&&ref.current.contains(element)?element.dataset.boardZone:null;};
  return <span ref={ref} className={inline?'board-inline-math':'board-math'} onClick={event=>{const zone=target(event);if(zone){event.stopPropagation();onZone(zone);}}} onKeyDown={event=>{const zone=target(event);if(zone)activate(event,()=>onZone(zone));}} dangerouslySetInnerHTML={{__html:markup}}/>;
}
function ZoneSurface({blockId,content,zones,selection,onSelect,className,math=false,inline=false}){
  const whole=zones.find(zone=>!Object.hasOwn(zone.anchor,'quote')),selectedZones=selectedFor(selection,blockId);
  const selected=Boolean(whole&&selectedZones.has(whole.id)),parts=whole?[]:zones;
  const choose=zoneId=>onSelect({blockId,zoneId});
  return <div data-board-block={blockId} className={`${className} ${zones.length?'has-zones':''} ${selected?'is-selected':''}`} onClick={event=>nearClick(event,blockId,onSelect)}>
    {whole&&<button data-board-zone={whole.id} className="board-whole-target" aria-label={whole.label} aria-pressed={selected} onClick={event=>{event.stopPropagation();choose(whole.id);}}/>}
    {math?<MathContent content={content} inline={inline} zones={parts} selectedZones={selectedZones} onZone={choose}/>:<span className={className==='board-axis-label'?'board-axis-text':'board-label'}><TextContent content={content} zones={parts} selectedZones={selectedZones} onZone={choose}/></span>}
  </div>;
}
function Matrix({block,zones,selection,onSelect}){
  const scrollRef=useRef(null),tableRef=useRef(null),[scrollable,setScrollable]=useState(false),proseColumns=matrixProseColumns(block.rows);
  useLayoutEffect(()=>{const node=scrollRef.current;const measure=()=>setScrollable(node.scrollWidth>node.clientWidth+1);measure();const observer=new ResizeObserver(measure);observer.observe(node);observer.observe(tableRef.current);return()=>observer.disconnect();},[block]);
  const at=container=>zones.filter(zone=>zone.target.container===container);
  return <div ref={scrollRef} className="board-matrix-scroll" role={scrollable?'region':undefined} tabIndex={scrollable?0:undefined} aria-label={scrollable?'Table. Scroll horizontally to read every column.':undefined}>
    {scrollable&&<p className="board-matrix-scroll-note" aria-hidden="true">Scroll to see every column</p>}
    <table ref={tableRef} className="board-matrix" aria-label={block.label||'Matrix'}>
    {block.columnLabels&&<thead><tr>{block.rowLabels&&<th aria-hidden="true"/>}{block.columnLabels.map((label,i)=><th key={i} scope="col"><ZoneSurface blockId={block.id} content={label} zones={at(`column-label:${i}`)} selection={selection} onSelect={onSelect} className="board-axis-label"/></th>)}</tr></thead>}
    <tbody>{block.rows.map((row,r)=><tr key={r}>{block.rowLabels&&<th scope="row"><ZoneSurface blockId={block.id} content={block.rowLabels[r]} zones={at(`row-label:${r}`)} selection={selection} onSelect={onSelect} className="board-axis-label"/></th>}{row.map((content,c)=><td key={c} className={proseColumns[c]?'is-prose-column':undefined}><ZoneSurface blockId={block.id} content={content} zones={at(`cell:${r}:${c}`)} selection={selection} onSelect={onSelect} className="board-cell" math={matrixCellIsMath(content)} inline/></td>)}</tr>)}</tbody>
  </table></div>;
}
function Diagram({block,zones,selection,onSelect}){
  const arrowId=`board-arrow-${useId().replace(/:/g,'')}`;
  return <svg data-board-block={block.id} className="board-diagram" viewBox="0 0 100 100" aria-label="Tutor diagram">
    <defs><marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10" fill="none" stroke="currentColor" strokeWidth="1.4"/></marker></defs>
    {block.elements.map((element,i)=>{
      const targets=zones.filter(zone=>zone.target.container===`element:${i}`),whole=targets.find(zone=>!Object.hasOwn(zone.anchor,'quote')),selectedZones=selectedFor(selection,block.id);
      const choose=zoneId=>onSelect({blockId:block.id,zoneId}),common={stroke:'currentColor',strokeWidth:.45,fill:'none'};
      let shape,label=element.label||element.text,x=element.x,y=element.y;
      if(element.type==='line'||element.type==='arrow')shape=<><line stroke="transparent" strokeWidth="5" x1={element.x1} y1={element.y1} x2={element.x2} y2={element.y2}/><line {...common} x1={element.x1} y1={element.y1} x2={element.x2} y2={element.y2} markerEnd={element.type==='arrow'?`url(#${arrowId})`:undefined}/></>;
      if(element.type==='circle')shape=<circle {...common} fill="transparent" cx={x} cy={y} r={element.r}/>;
      if(element.type==='rect'){shape=<rect {...common} fill="transparent" x={x} y={y} width={element.width} height={element.height} rx="1"/>;x+=element.width/2;y+=element.height/2;}
      const content=<>{shape}{label&&<text x={x} y={y} textAnchor="middle" dominantBaseline="central">{whole?label:<TextContent svg content={label} zones={targets} selectedZones={selectedZones} onZone={choose}/>}</text>}</>;
      return whole?<g key={i} data-board-zone={whole.id} className={`board-shape ${selectedZones.has(whole.id)?'is-selected':''}`} role="button" tabIndex={0} aria-label={whole.label} aria-pressed={selectedZones.has(whole.id)} onClick={event=>{event.stopPropagation();choose(whole.id);}} onKeyDown={event=>activate(event,()=>choose(whole.id))}>{content}</g>:<g key={i}>{content}</g>;
    })}
  </svg>;
}

function FlowDiagram({block}){
  const ref=useRef(null),[width,setWidth]=useState(null);
  const natural=useMemo(()=>layoutFlow(block),[block]);
  const scene=useMemo(()=>layoutFlow(block,{maxWidth:width}),[block,width]);
  useLayoutEffect(()=>{const node=ref.current;if(!node)return;const measure=()=>setWidth(node.clientWidth);measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[]);
  return <div ref={ref} className="board-flow-diagram" style={{'--flow-world-width':`${scene.width}px`,'--flow-natural-width':`${natural.width}px`}}><TeachingScene block={scene} zones={[]} interactive={false}/></div>;
}

function visibleZones(surface){
  const entries=[];
  for(const element of surface.querySelectorAll('[data-board-zone]')){
    const blockId=element.closest('[data-board-block]')?.dataset.boardBlock,zoneId=element.dataset.boardZone;
    if(!blockId||!zoneId)continue;
    for(const raw of element.getClientRects()){
      let left=raw.left,top=raw.top,right=raw.right,bottom=raw.bottom;
      for(let parent=element.parentElement;parent&&parent!==surface;parent=parent.parentElement){
        if(!parent.matches('.board-content,.board-math,.board-matrix-scroll,.teaching-scene-world,.teaching-scene'))continue;
        const clip=parent.getBoundingClientRect(),style=getComputedStyle(parent);
        if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}
        if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}
      }
      if(right>left&&bottom>top)entries.push({blockId,zoneId,left,top,right,bottom});
    }
  }
  return entries;
}
const intersects=(a,b)=>a.left<=b.right&&a.right>=b.left&&a.top<=b.bottom&&a.bottom>=b.top;
function SelectionGlass({surfaceRef,selection,board,lasso}){
  const [geometry,setGeometry]=useState({rects:[],clip:null}),id=useId().replace(/:/g,'');
  const keys=selectionTargets(selection).map(targetKey).sort().join('|');
  useEffect(()=>{
    const surface=surfaceRef.current;if(!surface)return;
    let frame=0,active=true;
    const measure=()=>{
      const bounds=surface.getBoundingClientRect(),content=surface.querySelector('.board-content').getBoundingClientRect();
      const selected=new Set(selectionTargets(selection).map(targetKey));
      const rects=visibleZones(surface).filter(rect=>selected.has(targetKey(rect))).map(rect=>({x:rect.left-bounds.left,y:rect.top-bounds.top,width:rect.right-rect.left,height:rect.bottom-rect.top}));
      const next={rects,clip:{x:content.left-bounds.left,y:content.top-bounds.top,width:content.width,height:content.height}};
      if(active)setGeometry(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    measure();const observer=new ResizeObserver(schedule);observer.observe(surface);observer.observe(surface.querySelector('.board-content'));
    surface.addEventListener('scroll',schedule,true);surface.addEventListener('board-view-change',schedule);window.addEventListener('resize',schedule);
    document.fonts?.ready.then(()=>{if(active)schedule();});
    return()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();surface.removeEventListener('scroll',schedule,true);surface.removeEventListener('board-view-change',schedule);window.removeEventListener('resize',schedule);};
  },[surfaceRef,keys,board,selection]);
  const contour=useMemo(()=>selectionContours(geometry.rects),[geometry.rects]);
  return <svg className="board-selection-glass" aria-hidden="true">
    <defs><linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b7c0c8" stopOpacity=".25"/><stop offset="1" stopColor="#87939e" stopOpacity=".16"/></linearGradient><clipPath id={`${id}-clip`}>{geometry.clip&&<rect {...geometry.clip}/>}</clipPath></defs>
    <g clipPath={`url(#${id}-clip)`} fill={`url(#${id}-glass)`} stroke="#aeb8c1" strokeOpacity=".25" strokeWidth=".6">
      {contour.d&&<path className="board-selection-contour" data-contour-count={contour.contours.length} d={contour.d} fillRule="evenodd" strokeLinejoin="round"/>}
    </g>
    {lasso&&<rect className="board-lasso" x={lasso.x} y={lasso.y} width={lasso.width} height={lasso.height} rx="5"/>}
  </svg>;
}

export default function Whiteboard({board,selection,onSelect,onClose,onMeasure,viewCache,viewScope='',interactive=true}){
  const surfaceRef=useRef(null),hoverRef=useRef(null),dragRef=useRef(null),suppressClick=useRef(0);
  const flowRef=useRef(null),measureCallback=useRef(onMeasure);measureCallback.current=onMeasure;
  // Measure the content's natural extent, independently of the frame that will
  // contain it. Resizing a frame cannot feed its own dimensions back as content.
  useLayoutEffect(()=>{
    const flow=flowRef.current;if(!flow)return;
    let pending=0,disposed=false;
    const measure=()=>{
      const bounds=flow.getBoundingClientRect();
      measureCallback.current?.({revision:board?.revision,width:Math.ceil(bounds.width),height:Math.ceil(bounds.height)});
    };
    const schedule=()=>{cancelAnimationFrame(pending);pending=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);observer.observe(flow);measure();
    document.fonts?.ready.then(()=>{if(!disposed)schedule();});
    return()=>{disposed=true;observer.disconnect();cancelAnimationFrame(pending);};
  },[board]);
  const [lasso,setLasso]=useState(null),[preview,setPreview]=useState(null);
  const currentSelection=interactive&&selection?.boardRevision===board?.revision?selection:null;
  const displayed=preview?{boardRevision:board?.revision,targets:preview}:currentSelection;
  const publish=targets=>{if(interactive&&board?.revision)onSelect?.({boardRevision:board.revision,targets:sortedTargets(targets)});};
  const select=target=>{
    if(!board?.revision||!target.blockId)return;
    const previous=selectionTargets(currentSelection),key=targetKey(target);
    publish(previous.some(item=>targetKey(item)===key)?previous.filter(item=>targetKey(item)!==key):[...previous,target]);
  };
  const clear=()=>{if(selectionTargets(currentSelection).length)publish([]);};
  function hover(event){
    if(!interactive)return;
    if(dragRef.current?.moved)return;
    const surface=event.target.closest('.board-cell,.board-block,.board-axis-label'),direct=event.target.closest('[data-board-zone]');
    const next=surface?nearestZone(surface,event):direct;
    if(next!==hoverRef.current){hoverRef.current?.removeAttribute('data-board-hover');next?.setAttribute('data-board-hover','true');hoverRef.current=next;}
  }
  function pointerDown(event){
    if(!interactive)return;
    if(event.button!==0||event.pointerType==='touch'||event.target.closest('.board-close,input,textarea,select,a')||(event.target.closest('button')&&!event.target.closest('[data-board-zone]')))return;
    suppressClick.current=0;
    event.currentTarget.focus({preventScroll:true});
    const bounds=event.currentTarget.getBoundingClientRect();
    dragRef.current={id:event.pointerId,x:event.clientX,y:event.clientY,bounds,revision:board?.revision,base:event.shiftKey||event.metaKey||event.ctrlKey?selectionTargets(currentSelection):[],moved:false,targets:[]};
  }
  function pointerMove(event){
    if(!interactive)return;
    const drag=dragRef.current;
    if(!drag||drag.id!==event.pointerId){hover(event);return;}
    if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<5){hover(event);return;}
    if(drag.revision!==board?.revision){cancelDrag();return;}
    if(!drag.moved){drag.moved=true;event.currentTarget.setPointerCapture(event.pointerId);hoverRef.current?.removeAttribute('data-board-hover');hoverRef.current=null;}
    event.preventDefault();
    const rect={left:Math.min(drag.x,event.clientX),top:Math.min(drag.y,event.clientY),right:Math.max(drag.x,event.clientX),bottom:Math.max(drag.y,event.clientY)};
    drag.targets=sortedTargets([...drag.base,...visibleZones(event.currentTarget).filter(zone=>intersects(rect,zone))]);
    setPreview(drag.targets);setLasso({x:rect.left-drag.bounds.left,y:rect.top-drag.bounds.top,width:rect.right-rect.left,height:rect.bottom-rect.top});
  }
  function cancelDrag(){const drag=dragRef.current;dragRef.current=null;if(drag&&surfaceRef.current?.hasPointerCapture(drag.id))surfaceRef.current.releasePointerCapture(drag.id);setPreview(null);setLasso(null);}
  function pointerUp(event){
    if(!interactive)return;
    const drag=dragRef.current;if(!drag||drag.id!==event.pointerId)return;
    if(drag.moved){suppressClick.current=performance.now()+300;if(drag.revision===board?.revision)publish(drag.targets);}
    cancelDrag();
  }
  useEffect(()=>{cancelDrag();},[board?.revision]);
  return <section ref={surfaceRef} tabIndex={-1} className={`whiteboard ${interactive?'has-selection-glass':'is-readonly'} ${lasso?'is-lassoing':''}`} aria-label="Study whiteboard" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelDrag} onPointerLeave={()=>{hoverRef.current?.removeAttribute('data-board-hover');hoverRef.current=null;if(!dragRef.current?.moved)dragRef.current=null;}} onClickCapture={event=>{if(performance.now()<suppressClick.current){event.preventDefault();event.stopPropagation();suppressClick.current=0;}}} onClick={event=>{if(!event.target.closest('button,[data-board-zone]'))clear();}} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();if(dragRef.current?.moved)suppressClick.current=Infinity;cancelDrag();clear();}}}>
    {interactive&&<SelectionGlass surfaceRef={surfaceRef} selection={displayed} board={board} lasso={lasso}/>}
    <button className="icon-button board-close" aria-label="Close whiteboard" onClick={onClose}><X size={17}/></button>
    <div className="board-content"><div className="board-flow" ref={flowRef}>{board?.blocks?.slice(0,12).map((block,i)=>{
      const zones=interactive?resolvedZones(block):[];
      if(block.type==='plot')return <TeachingPlot key={block.id} block={block}/>;
      if(block.type==='annotation')return <TeachingAnnotation key={block.id} block={block}/>;
      if(block.type==='flow')return <FlowDiagram key={block.id} block={block}/>;
      if(block.type==='scene'){
        const viewKey=JSON.stringify([viewScope,block.id,board.title,block.width,block.height]);
        const saveCamera=camera=>{if(!viewCache)return;viewCache.set(viewKey,camera);if(viewCache.size>64)viewCache.delete(viewCache.keys().next().value);};
        return <TeachingScene key={viewKey} interactive={interactive} block={block} zones={zones} selection={displayed} onSelect={select} initialCamera={viewCache?.get(viewKey)} onCameraChange={saveCamera} onViewChange={()=>surfaceRef.current?.dispatchEvent(new Event('board-view-change'))}/>;
      }
      if(block.type==='matrix')return <Matrix key={block.id||i} block={block} zones={zones} selection={displayed} onSelect={select}/>;
      if(block.type==='diagram')return <Diagram key={block.id||i} block={block} zones={zones} selection={displayed} onSelect={select}/>;
      return <ZoneSurface key={block.id||i} blockId={block.id} content={block.content} zones={zones} selection={displayed} onSelect={select} className="board-block" math={block.type==='latex'}/>;
    })}</div></div>
  </section>;
}
