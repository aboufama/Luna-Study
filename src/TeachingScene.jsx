import React, {useId,useLayoutEffect,useRef,useState} from 'react';
import {Hand, Minus, Plus, Scan} from 'lucide-react';
import {renderZonedMath} from '../shared/board-parts.mjs';
import {sceneCamera,zoomScene,panScene} from './scene-camera.mjs';
import {sceneLabelLayout} from './scene-label-layout.mjs';
import './teaching-scene.css';
import BoardRichText from './BoardRichText.jsx';

function ZoneText({text,zones=[],selected=new Set(),onZone,svg=false}){
  if(!svg&&!zones.length)return <BoardRichText text={text}/>;
  const Tag=svg?'tspan':'span';let cursor=0;
  const parts=[...zones].sort((a,b)=>a.target.start-b.target.start).map(zone=>{
    const gap=text.slice(cursor,zone.target.start);cursor=zone.target.end;
    return <React.Fragment key={zone.id}>{gap}<Tag data-board-zone={zone.id} role="button" tabIndex={0} aria-label={zone.label} aria-pressed={selected.has(zone.id)} onClick={event=>{event.stopPropagation();onZone(zone.id);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();onZone(zone.id);}}}>{text.slice(zone.target.start,zone.target.end)}</Tag></React.Fragment>;
  });return <>{parts}{text.slice(cursor)}</>;
}
function ObjectText({object,zones=[],selected=new Set(),onZone}){
  const ref=useRef(null),[fit,setFit]=useState(1),math=object.type==='math';
  const markup=math?renderZonedMath(object.text,zones,{inline:true}):null;
  useLayoutEffect(()=>{
    const element=ref.current;if(!element)return;let active=true;
    const measure=()=>{if(active)setFit(Math.min(1,object.width/Math.max(1,element.scrollWidth),object.height/Math.max(1,element.scrollHeight)));};
    measure();document.fonts?.ready.then(measure);return()=>{active=false;};
  },[object.text,object.width,object.height,object.fontSize]);
  useLayoutEffect(()=>{if(!math)return;for(const node of ref.current.querySelectorAll('[data-board-zone]')){const zone=zones.find(z=>z.id===node.dataset.boardZone);if(zone){node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',zone.label);node.setAttribute('aria-pressed',String(selected.has(zone.id)));}}},[markup,zones,selected,math]);
  const activate=event=>{const node=event.target.closest('[data-board-zone]');if(node&&ref.current.contains(node)){event.preventDefault();event.stopPropagation();onZone?.(node.dataset.boardZone);}};
  return <foreignObject x={object.x} y={object.y} width={object.width} height={object.height} className="scene-writing-box">
    <div className="scene-writing-fit" data-text-fit={fit.toFixed(3)} style={{transform:`scale(${fit})`,width:object.width}}>
      <div ref={ref} className={`scene-writing ${math?'scene-math':''}`} style={{fontSize:object.fontSize||22}} {...(math?{dangerouslySetInnerHTML:{__html:markup},onClick:activate,onKeyDown:event=>{if(event.key==='Enter'||event.key===' ')activate(event);}}:{children:<ZoneText text={object.text} zones={zones} selected={selected} onZone={onZone}/>})}/>
    </div>
  </foreignObject>;
}

function SceneObject({object,arrowId,zones,selected,onZone,labelBox}){
  const o=object,common={fill:'none',stroke:'currentColor',strokeWidth:1.8,vectorEffect:'non-scaling-stroke'};
  if(o.type==='text'||o.type==='math')return <ObjectText object={o} zones={zones} selected={selected} onZone={onZone}/>;
  let shape,label;
  if(o.type==='rect')shape=<rect {...common} x={o.x} y={o.y} width={o.width} height={o.height} rx={Math.min(10,o.width/10,o.height/10)} fill="transparent"/>;
  if(o.type==='ellipse')shape=<ellipse {...common} cx={o.x+o.width/2} cy={o.y+o.height/2} rx={o.width/2} ry={o.height/2} fill="transparent"/>;
  if(o.type==='line'||o.type==='arrow')shape=<><line stroke="transparent" strokeWidth="18" x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2}/><line {...common} x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} markerEnd={o.type==='arrow'?`url(#${arrowId})`:undefined}/></>;
  if(o.type==='polyline')shape=<><polyline fill="none" stroke="transparent" strokeWidth="18" points={o.points.map(p=>p.join(',')).join(' ')}/><polyline {...common} points={o.points.map(p=>p.join(',')).join(' ')}/></>;
  if(o.label&&labelBox)label=<ObjectText object={{type:'text',text:o.label,...labelBox,fontSize:18}} zones={zones} selected={selected} onZone={onZone}/>;
  return <>{shape}{label}</>;
}

// Only validated data reaches this renderer. Camera state belongs to the viewer,
// not the model, so an object patch cannot reset the learner's point of view.
export default function TeachingScene({block,zones,selection,onSelect,onViewChange,initialCamera,onCameraChange,interactive=true}){
  const id=useId().replace(/:/g,''),svg=useRef(null),scroller=useRef(null),drag=useRef(null),[scrollable,setScrollable]=useState(false),[camera,setCamera]=useState(()=>sceneCamera(initialCamera,block.width,block.height)),[panning,setPanning]=useState(false);
  const selected=new Set((selection?.targets||(selection?.zoneId?[selection]:[])).filter(t=>t.blockId===block.id).map(t=>t.zoneId));
  const current=sceneCamera(interactive?camera:null,block.width,block.height);
  const labels=sceneLabelLayout(block);
  const update=next=>{setCamera(next);onCameraChange?.(next);onViewChange?.();};
  useLayoutEffect(()=>{onViewChange?.();},[camera,block]);
  useLayoutEffect(()=>{const node=scroller.current;if(!node)return;const measure=()=>setScrollable(node.scrollWidth>node.clientWidth+1);measure();const observer=new ResizeObserver(measure);observer.observe(node);if(svg.current)observer.observe(svg.current);return()=>observer.disconnect();},[block.width,block.height]);
  function start(event){
    if(!interactive)return;
    if(!(panning||event.altKey||event.button===1)||event.target.closest('button'))return;
    event.stopPropagation();event.preventDefault();event.currentTarget.focus({preventScroll:true});
    const bounds=svg.current.getBoundingClientRect();drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,camera:current,width:bounds.width,height:bounds.height};event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event){
    const d=drag.current;if(!d||d.id!==event.pointerId)return;event.stopPropagation();event.preventDefault();
    update(panScene(d.camera,(d.x-event.clientX)*block.width/d.width/d.camera.zoom,(d.y-event.clientY)*block.height/d.height/d.camera.zoom,block.width,block.height));
  }
  function end(event){if(!drag.current)return;event.stopPropagation();drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
  return <div ref={scroller} className={`teaching-scene ${panning?'is-panning':''}`} data-scene-id={block.id} role={!interactive&&scrollable?'region':undefined} tabIndex={interactive||scrollable?0:undefined} aria-label={interactive?"Teaching canvas. Arrow keys pan; plus and minus zoom; zero resets. Alt-drag to pan.":scrollable?"Teaching diagram. Scroll horizontally to see the full diagram.":"Teaching diagram"} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={event=>{
    if(!interactive||event.target.closest('[data-board-zone],button'))return;
    const direction={ArrowLeft:[-40,0],ArrowRight:[40,0],ArrowUp:[0,-40],ArrowDown:[0,40]}[event.key];
    if(direction){event.preventDefault();event.stopPropagation();update(panScene(current,direction[0]/current.zoom,direction[1]/current.zoom,block.width,block.height));}
    else if(['+','=','-','0'].includes(event.key)){event.preventDefault();event.stopPropagation();update(event.key==='0'?sceneCamera(null,block.width,block.height):zoomScene(current,event.key==='-'?1/1.25:1.25,block.width,block.height));}
    else if(event.key==='Escape')setPanning(false);
  }}>
    {!interactive&&scrollable&&<p className="scene-scroll-note" aria-hidden="true">Scroll to see the full diagram</p>}
    <svg ref={svg} data-board-block={block.id} className="teaching-scene-world" viewBox={`${current.x} ${current.y} ${block.width/current.zoom} ${block.height/current.zoom}`} style={{aspectRatio:`${block.width}/${block.height}`}} aria-label="Tutor teaching scene">
      <defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 9 5 1 9" fill="none" stroke="context-stroke" strokeWidth="1.5"/></marker></defs>
      {block.objects.map(object=>{
        const targets=zones.filter(z=>z.target.objectId===object.id),zone=targets.find(z=>!Object.hasOwn(z.anchor,'quote')),active=zone&&selected.has(zone.id);
        const positioned=['text','math','rect','ellipse'].includes(object.type),local=positioned?{...object,x:0,y:0}:object;
        const label=labels.get(object.id),labelBox=label&&positioned?{...label,x:label.x-object.x,y:label.y-object.y}:label;
        return <g key={object.id} data-scene-object={object.id} data-board-zone={zone?.id} style={positioned?{transform:`translate(${object.x}px,${object.y}px)`}:undefined} onTransitionEnd={onViewChange} className={`scene-object scene-tone-${object.tone||'ink'} ${active?'is-selected':''}`} {...(zone?{role:'button',tabIndex:0,'aria-label':zone.label,'aria-pressed':Boolean(active),onClick:event=>{event.stopPropagation();if(!panning&&!event.altKey)onSelect({blockId:block.id,zoneId:zone.id});},onKeyDown:event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();onSelect({blockId:block.id,zoneId:zone.id});}}}:{})}><SceneObject object={local} arrowId={`${id}-arrow`} labelBox={labelBox} zones={zone?[]:targets} selected={selected} onZone={zoneId=>{if(!panning)onSelect({blockId:block.id,zoneId});}}/></g>;
      })}
    </svg>
    {interactive&&<nav className="scene-tools" aria-label="Canvas view" onClick={event=>event.stopPropagation()}>
      <button type="button" aria-label="Pan canvas" aria-pressed={panning} title="Pan canvas (or Alt-drag)" onClick={()=>setPanning(!panning)}><Hand size={16}/></button>
      <button type="button" aria-label="Zoom out" disabled={current.zoom<=.5} onClick={()=>update(zoomScene(current,1/1.25,block.width,block.height))}><Minus size={16}/></button>
      <button type="button" aria-label="Zoom in" disabled={current.zoom>=4} onClick={()=>update(zoomScene(current,1.25,block.width,block.height))}><Plus size={16}/></button>
      <button type="button" aria-label="Fit canvas" title="Fit canvas" onClick={()=>update(sceneCamera(null,block.width,block.height))}><Scan size={16}/></button>
    </nav>}
  </div>;
}
