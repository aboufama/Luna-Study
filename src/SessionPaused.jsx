import React,{useEffect,useRef} from 'react';
import {Play} from 'lucide-react';
import './session-paused.css';

export default function SessionPaused({resuming,error,onResume}){
  const ref=useRef(null),button=useRef(null);
  useEffect(()=>{
    const previous=document.activeElement,parent=ref.current.parentElement,states=new Map();
    const disable=()=>{for(const node of parent.children)if(node!==ref.current&&!states.has(node)){states.set(node,node.inert);node.inert=true;}};
    disable();const observer=new MutationObserver(disable);observer.observe(parent,{childList:true});button.current?.focus({preventScroll:true});
    return()=>{observer.disconnect();for(const [node,inert] of states)node.inert=inert;if(previous?.isConnected)previous.focus?.({preventScroll:true});};
  },[]);
  return <section ref={ref} className="session-paused-overlay" role="dialog" aria-label="Session paused" aria-describedby="session-paused-description">
    <div className="session-paused-card"><span className="session-paused-mark"><Play size={20}/></span><h2>Session paused</h2><p id="session-paused-description">Your microphone is off. Your question and hints are saved.<br/>Resume whenever you’re ready.</p>{error&&<p className="session-paused-error" role="alert">{error}</p>}<button ref={button} type="button" className="session-resume" aria-disabled={resuming} onClick={()=>{if(!resuming)onResume();}}>{resuming?'Resuming…':'Resume'}{!resuming&&<Play size={14}/>}</button><span className="hint-sr-only" role="status">{resuming?'Reconnecting the microphone.':''}</span></div>
  </section>;
}
