import React,{useEffect,useState} from 'react';
import{createRoot}from'react-dom/client';
import Whiteboard from './Whiteboard.jsx';
import './style.css';
import './QualityDemo.css';
const files=['boards-results.json','boards-repaired-results.json','boards-replay-results.json','boards-final-results.json','boards-renderer-repair.json'];
const labels={'math-long-chain':'Math · long equation','hydraulic-legend':'Physics · symbols','biology-process':'Biology · transcription','chemistry-process':'Chemistry · phases','programming-branch':'Programming · decisions','grammar-annotation':'Language · clauses','history-timeline':'History · chronology','physics-forces':'Physics · forces','math-parabola':'Math · a curve','probability-tree':'Probability · outcomes','game-table':'Game theory · choices','math-negative-slope':'Economics · demand','literature-annotation':'Literature · metaphor'};
function QualityDemo(){
 const[data,setData]=useState(null),[error,setError]=useState(''),[selected,setSelected]=useState('grammar-annotation'),[condition,setCondition]=useState('revised'),[visible,setVisible]=useState(true);
 useEffect(()=>{let active=true;Promise.all(files.map(async name=>{const response=await fetch(`/benchmarks/tutor-quality/${name}`);if(!response.ok)throw Error('Saved outputs are unavailable.');return response.json();})).then(value=>{if(active)setData(value)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[]);
 if(!data)return <main className="quality-loading">{error||'Loading saved teaching examples…'}</main>;
 const[initial,repaired,replay,final,rendererRepair]=data,base=initial.runs.find(r=>r.scenario===selected&&r.condition==='before');
 const latest=rendererRepair.runs.find(r=>r.scenario===selected)||final.runs.find(r=>r.scenario===selected&&r.board)||repaired.runs.find(r=>r.scenario===selected&&r.board)||initial.runs.find(r=>r.scenario===selected&&r.condition==='current');
 const nested=selected==='grammar-annotation'?replay.runs.find(r=>r.previousStatus==='no-board'):null;
 const record=condition==='before'?base:condition==='nested'?nested:latest;
 const subject=id=>{setSelected(id);setCondition('revised');setVisible(true)};
 return <div className="quality-demo">
  <header><a href="/" className="quality-brand">luna<span>Teaching lab</span></a><a href="/">Open live tutor ↗</a></header>
  <main><div className="quality-heading"><p>Actual model outputs · current renderer</p><h1>Less guessing. More teaching.</h1><p>Explore the saved runs, including the failures. The board uses the same renderer as your study session.</p></div>
   <div className="quality-layout"><nav aria-label="Teaching examples">{Object.entries(labels).map(([id,label])=><button key={id} aria-pressed={selected===id} onClick={()=>subject(id)}>{label}</button>)}</nav>
    <section className="quality-content"><div className="quality-toolbar"><h2>{labels[selected]}</h2><div role="group" aria-label="Choose recorded run">{base&&<button aria-pressed={condition==='before'} onClick={()=>{setCondition('before');setVisible(true)}}>Earlier run</button>}<button aria-pressed={condition==='revised'} onClick={()=>{setCondition('revised');setVisible(true)}}>{selected==='math-long-chain'?'Renderer repair':'Revised run'}</button>{nested&&<button aria-pressed={condition==='nested'} onClick={()=>{setCondition('nested');setVisible(true)}}>Recovered edge case</button>}</div></div>
     <div className="quality-canvas">{record?.board&&visible?<Whiteboard board={record.board} interactive={false} onClose={()=>setVisible(false)}/>:<div className="quality-empty"><p>{record?.board?'The board is tucked away.':'This model response did not produce an accepted board.'}</p>{record?.board&&<button onClick={()=>setVisible(true)}>Reopen board</button>}</div>}</div>
     <div className="quality-response"><span>Luna said</span><p>{record?.result?.reply||'No spoken output recorded.'}</p></div>
     <div className="quality-meta"><span>First text <strong>{record?.latencies?.firstTextMs?`${(record.latencies.firstTextMs/1000).toFixed(2)} s`:'—'}</strong></span><span>Generation finished <strong>{record?.latencies?.completeMs?`${(record.latencies.completeMs/1000).toFixed(2)} s`:'—'}</strong></span><span>{selected==='math-long-chain'?'Rejected live candidate · renderer repair':condition==='nested'?'Replayed original failed output; no new model call':'GPT-5.6 Terra · recorded run'}</span></div>
     <details><summary>Source and verification context</summary><p>{record?.source}</p><p>Request: {record?.request}</p><p>These are saved examples, not a live model conversation. Revised runs include follow-up experiments; timings are individual samples, not a controlled speed comparison. No microphone or paid call is used here. Smooth curves interpolate supplied samples; they do not infer an exact equation. Earlier and revised outputs both use the current renderer.</p></details>
    </section></div>
   <footer>Try the complete flow in the <a href="/">live tutor</a>: import a screenshot, start a session, use Hint, or pause and resume. This lab does not award mastery.</footer>
  </main>
 </div>;
}
createRoot(document.getElementById('root')).render(<QualityDemo/>);
