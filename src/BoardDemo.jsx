import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowRight,Atom,BookOpen,Check,ChevronRight,Eye,EyeOff,Leaf,MessageCircle,Plus,RotateCcw,Sparkles,SquareFunction} from 'lucide-react';
import Whiteboard from './Whiteboard.jsx';
import {demoSubjects,demoBoard,patchDemoBoard,demoAnnotation} from './board-demo-data.mjs';
import './BoardDemo.css';

const icons={biology:Leaf,algebra:SquareFunction,physics:Atom,grammar:BookOpen};
const revision=()=>crypto.randomUUID();
function BoardDemo(){
  const [subjectId,setSubjectId]=useState('biology'),[exampleIndex,setExampleIndex]=useState(0),[viewEpoch,setViewEpoch]=useState(0);
  const subject=demoSubjects.find(item=>item.id===subjectId),example=subject.examples[exampleIndex];
  const [board,setBoard]=useState(()=>demoBoard(demoSubjects[0].examples[0],revision()));
  const [visible,setVisible]=useState(true),[updated,setUpdated]=useState(false),[annotated,setAnnotated]=useState(false),[status,setStatus]=useState('Use the controls below to follow this teaching example.');
  const viewCache=useRef(new Map());
  function load(id,index){
    const next=demoSubjects.find(item=>item.id===id).examples[index];
    setSubjectId(id);setExampleIndex(index);setBoard(demoBoard(next,revision()));setVisible(true);setUpdated(false);setAnnotated(false);
    viewCache.current.clear();setViewEpoch(value=>value+1);setStatus(index?'A new example replaces the previous scene.':'Use the controls below to follow this teaching example.');
  }
  function patch(objects,message){
    const next=patchDemoBoard(board,objects,revision());
    setBoard(next);setVisible(true);setStatus(message);
  }
  function toggle(){setVisible(!visible);setStatus(visible?'Board hidden. Your scene is kept.':'The same scene is back.');}
  const Icon=icons[subjectId];
  return <div className="board-demo">
    <a className="demo-skip" href="#demo-controls">Skip to demo controls</a>
    <header className="demo-header">
      <a href="/" className="demo-brand" aria-label="Luna home"><span className="demo-logo"><span/></span><strong>luna</strong><span className="demo-brand-divider"/><span>Whiteboard playground</span></a>
      <a className="demo-live-link" href="/">Open live tutor <ArrowRight size={16}/></a>
    </header>
    <main>
      <section className="demo-intro">
        <div><p className="demo-eyebrow"><span/> Scripted scenarios · production renderer</p><h1>A little room to think.</h1><p className="demo-lede">See an idea. Follow a step. Return to the same problem.</p></div>
        <div className="demo-subjects" role="group" aria-label="Choose a subject">{demoSubjects.map(item=>{const SubjectIcon=icons[item.id];return <button key={item.id} type="button" aria-pressed={subjectId===item.id} onClick={()=>load(item.id,0)}><SubjectIcon size={17}/>{item.label}</button>;})}</div>
      </section>
      <div className="demo-workspace">
        <section className="demo-canvas-card" aria-labelledby="demo-board-title">
          <div className="demo-canvas-header"><div><span className="demo-subject-icon"><Icon size={18}/></span><div><p>{subject.eyebrow}</p><h2 id="demo-board-title">{example.title}</h2></div></div><span className={`demo-visibility ${visible?'':'is-hidden'}`}><span/>{visible?'Board open':'Board saved'}</span></div>
          <div className="demo-canvas-stage">
            {visible?<Whiteboard interactive={false} board={board} selection={null} onClose={toggle} viewCache={viewCache.current} viewScope={`${subjectId}:${exampleIndex}:${viewEpoch}`}/>:<div className="demo-hidden"><span className="demo-hidden-icon"><EyeOff size={27}/></span><h3>A moment away from the board.</h3><p>Your scene is right where you left it.</p><button className="demo-primary" onClick={toggle}><Eye size={17}/>Reopen the board</button></div>}
          </div>
          <div className="demo-canvas-footer"><span><Eye size={15}/>A board for reading</span><span>Use the controls below to follow the next step</span></div>
          <div className="demo-controls" id="demo-controls" tabIndex={-1}>
            <button className="demo-primary" disabled={updated} onClick={()=>{patch(example.updates,example.updateReply);setUpdated(true);}}>{updated?<Check size={16}/>:<Sparkles size={16}/>}<span>{updated?'Step added':example.action}</span></button>
            <button className="demo-secondary" disabled={annotated} onClick={()=>{patch([demoAnnotation(example)],'A teaching note was added without replacing the scene.');setAnnotated(true);}}>{annotated?<Check size={16}/>:<Plus size={16}/>}<span>{annotated?'Note added':'Add a note'}</span></button>
            <button className="demo-secondary demo-hide" onClick={toggle}>{visible?<EyeOff size={16}/>:<Eye size={16}/>}<span>{visible?'Hide':'Reopen'}</span></button>
            <button className="demo-reset" aria-label="Reset current example" title="Reset current example" onClick={()=>load(subjectId,exampleIndex)}><RotateCcw size={17}/></button>
          </div>
        </section>
        <aside className="demo-side">
          <section className="demo-context-card"><div className="demo-section-title"><MessageCircle size={17}/><h2>The teaching moment</h2><span>Scripted</span></div><div className="demo-dialogue"><p className="demo-speaker">Student</p><p className="demo-student">{example.prompt}</p><p className="demo-speaker demo-tutor-label"><span className="demo-mini-orb"/>Luna</p><p className="demo-tutor">{updated?example.updateReply:example.reply}</p></div><div className="demo-try"><span>Try this</span><p>Follow the next step, add a teaching note, or hide and reopen the same scene.</p></div></section>
          <section className="demo-selection-card" aria-labelledby="example-state-title"><div className="demo-section-title"><BookOpen size={17}/><h2 id="example-state-title">Current example</h2></div><p className="demo-selection-empty">{example.title}</p><p className="demo-selection-help">{updated?'The next teaching step is shown.':'The initial problem is shown.'} {annotated?'A teaching note is included.':''} These are scripted examples; nothing is graded here.</p></section>
          <button className="demo-next" onClick={()=>load(subjectId,1-exampleIndex)}><span><small>Another angle</small><strong>{subject.examples[1-exampleIndex].title}</strong></span><ChevronRight size={20}/></button>
        </aside>
      </div>
      <p className="demo-status" role="status"><span/>{status}</p>
      <footer className="demo-footer"><p>Hand-authored, validated examples. The same reading view as the live tutor.<br/>This playground does not call an AI model or use your microphone.</p><a href="/">Bring your own materials to the live tutor <ArrowRight size={15}/></a></footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')).render(<BoardDemo/>);
