import React, { useEffect, useRef, useState } from 'react';
import { X, ArrowRight } from 'lucide-react';

export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const prettyDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Choose a date';
const kinds = ['quiz','test','final'];

export function DifficultySlider({value,onChange}) {
  const [dragging,setDragging]=useState(false), [display,setDisplay]=useState(kinds.indexOf(value)*50);
  useEffect(()=>{if(!dragging)setDisplay(kinds.indexOf(value)*50);},[value,dragging]);
  function settle(){setDragging(false);const snapped=Math.round(display/50);setDisplay(snapped*50);onChange(kinds[snapped]);}
  return <div className={`difficulty-slider ${dragging?'dragging':''}`} style={{'--slider-position':`${display}%`}}>
    <div className="difficulty-track"><div className="difficulty-fill"/><div className="difficulty-knob"/></div>
    <input aria-label="Difficulty" aria-valuetext={value} type="range" min="0" max="100" step="1" value={display} onPointerDown={()=>setDragging(true)} onPointerUp={settle} onPointerCancel={settle} onBlur={settle} onChange={e=>{const n=Number(e.target.value);setDisplay(n);onChange(kinds[Math.round(n/50)]);}} onKeyDown={e=>{if(['ArrowRight','ArrowUp','ArrowLeft','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const current=kinds.indexOf(value),next=e.key==='Home'?0:e.key==='End'?2:Math.max(0,Math.min(2,current+(['ArrowRight','ArrowUp'].includes(e.key)?1:-1)));setDisplay(next*50);onChange(kinds[next]);}}}/>
    <div className="difficulty-labels">{kinds.map((kind,i)=><button type="button" key={kind} aria-pressed={value===kind} className={value===kind?'selected':''} onClick={()=>{onChange(kind);setDisplay(i*50);}}>{kind}</button>)}</div>
  </div>;
}

export default function CreateTest({onClose,onCreate}) {
  const ref=useRef(null),[className,setClassName]=useState(''),[difficulty,setDifficulty]=useState('test');
  useEffect(()=>{ref.current.showModal();},[]);
  return <dialog ref={ref} className="create-dialog" aria-labelledby="create-title" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="dialog-heading"><h1 id="create-title">New test</h1><button className="icon-button" aria-label="Close new test" onClick={onClose}><X size={18}/></button></div>
    <form onSubmit={e=>{e.preventDefault();if(className.trim())onCreate({className:className.trim(),date:'',difficulty});}}>
      <input id="class-name" aria-label="Class" autoFocus autoComplete="off" maxLength={100} placeholder="Class" required value={className} onChange={e=>setClassName(e.target.value)}/>
      <div className="form-field difficulty-field"><span className="field-label">Difficulty</span><DifficultySlider value={difficulty} onChange={setDifficulty}/></div>
      <button className="solid-button create-button" type="submit" disabled={!className.trim()}>Create <ArrowRight size={17}/></button>
    </form>
  </dialog>;
}
