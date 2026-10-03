import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, FilePlus2, Pause, Play, RotateCcw, Shuffle, Square } from 'lucide-react';
import * as original from './original.mjs';
import * as palimpsest from './palimpsest.mjs';
import * as filigree from './filigree.mjs';
import Preview from './Preview.jsx';
import './lab.css';

const variants=[original,palimpsest,filigree],INITIAL=805502294;
const randomSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
const derive=(master,salt)=>{let n=(master^salt)>>>0;n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return (n^(n>>>16))>>>0;};
function startingSeed(){const raw=new URLSearchParams(location.search).get('seed');return raw!==null&&/^\d+$/.test(raw)&&Number(raw)<=4294967295?Number(raw):INITIAL;}
export default function Lab(){
  const [seed,setSeed]=useState(startingSeed),[state,setState]=useState('thinking'),[energy,setEnergy]=useState(.75),[board,setBoard]=useState(false),[drop,setDrop]=useState(0);
  const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),[playing,setPlaying]=useState(true);
  const [favorite,setFavorite]=useState(()=>{try{return JSON.parse(localStorage.getItem('mosaic-lab-choice')||'null');}catch{return null;}});
  const [focus,setFocus]=useState(null),[revision,setRevision]=useState(0),clock=useRef({time:0}),running=useRef(playing);running.current=playing;
  useEffect(()=>{let frame,last=performance.now();function tick(now){if(running.current&&!document.hidden)clock.current.time+=Math.min(80,now-last);last=now;frame=requestAnimationFrame(tick);}frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[]);
  useEffect(()=>{const query=new URLSearchParams(location.search);query.set('seed',String(seed));history.replaceState(null,'',`${location.pathname}?${query}`);},[seed]);
  function choose(variant){const choice={id:variant.meta.id,title:variant.meta.title,seed,variantSeed:variant.meta.id==='original'?0:derive(seed,variant.meta.seed)};setFavorite(choice);try{localStorage.setItem('mosaic-lab-choice',JSON.stringify(choice));}catch{}}
  function restart(){clock.current.time=0;setRevision(value=>value+1);}
  function reroll(){setSeed(randomSeed());restart();}
  function focusOn(id){setFocus(id);restart();}
  const controls={state,energy,board,drop,playing,reduced};
  return <main className="mosaic-lab">
    <header className="lab-header"><a href="/" className="lab-back"><ArrowLeft size={16}/><span>Study</span></a><span className="lab-status"><i/>Silent preview</span></header>
    <section className="lab-intro"><div><p className="lab-eyebrow">A study in movement</p><h1>A closer study.</h1><p className="lab-lede">The original, beside two new studies in individual motion.<br/>Same stones. Each piece follows its own carefully timed path.</p></div><div className="lab-seed"><span>Seed <code>{seed}</code></span><button onClick={reroll}><Shuffle size={14}/>New seed</button><button aria-label="Restart animation" onClick={restart}><RotateCcw size={14}/></button></div></section>
    <div className="lab-controls"><div className="lab-states" role="group" aria-label="Animation state">{[['idle','Resting'],['thinking','Thinking'],['speaking','Talking'],['listening','Listening']].map(([value,label])=><button key={value} aria-pressed={state===value} onClick={()=>setState(value)}>{label}</button>)}</div><div className="lab-actions"><button onClick={()=>setDrop(value=>value+1)} disabled={!playing}><FilePlus2 size={15}/>Add documents</button><button aria-pressed={board} onClick={()=>setBoard(!board)}><Square size={14}/>Whiteboard</button><button onClick={()=>setPlaying(!playing)} aria-label={playing?'Pause animations':'Play animations'}>{playing?<Pause size={15}/>:<Play size={15}/>}</button></div></div>
    <div className={`lab-grid ${focus?'is-focused':''}`}>{variants.filter(variant=>!focus||variant.meta.id===focus).map(variant=>{const chosen=favorite?.id===variant.meta.id&&favorite.seed===seed;return <article className={`lab-card ${chosen?'chosen':''}`} key={variant.meta.id}><div className="lab-card-heading"><span>{variant.meta.id==='original'?'CURRENT':String(variants.indexOf(variant)).padStart(2,'0')}</span><button onClick={()=>focusOn(focus?null:variant.meta.id)} aria-label={focus?'Show all concepts':`Enlarge ${variant.meta.title}`}><ArrowUpRight size={16}/></button></div><Preview key={`${variant.meta.id}-${revision}`} variant={variant} seed={variant.meta.id==='original'?0:derive(seed,variant.meta.seed)} controls={controls} clock={clock}/><div className="lab-card-copy"><div><h2>{variant.meta.title}</h2><p>{variant.meta.description}</p></div><button className="lab-choose" aria-pressed={chosen} onClick={()=>choose(variant)}>{chosen?<><Check size={14}/>Selected</>:'Choose this'}</button></div></article>;})}</div>
    <footer className="lab-footer"><label>Voice energy<input aria-label="Simulated voice energy" type="range" min="0" max="1" step=".01" value={energy} onChange={event=>setEnergy(Number(event.target.value))}/></label><button className="lab-reduced" aria-pressed={reduced} onClick={()=>setReduced(!reduced)}>{reduced?'Reduced motion on':'Reduced motion off'}</button><p>{favorite?`${favorite.title} saved as your preference. The study app is unchanged.`:'No microphone, generated speech, or API usage.'}</p></footer>
  </main>;
}
