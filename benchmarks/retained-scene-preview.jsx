import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Whiteboard from '../src/Whiteboard.jsx';
import '../src/style.css';
import '../src/mosaic-stage.css';
const initial={title:'Cell structure',revision:'fixture-1',blocks:[{id:'cell',type:'scene',width:800,height:500,objects:[
 {id:'membrane',type:'ellipse',x:140,y:60,width:430,height:310},
 {id:'nucleus',type:'ellipse',x:280,y:165,width:130,height:100,label:'nucleus'},
 {id:'cytoplasm',type:'text',x:185,y:115,width:195,height:38,text:'cytoplasm'},
 {id:'membrane-label',type:'text',x:585,y:75,width:205,height:70,text:'cell membrane'},
 {id:'membrane-leader',type:'line',x1:510,y1:105,x2:585,y2:105},
 {id:'note',type:'text',x:195,y:410,width:500,height:40,text:'Membrane: selective boundary'},
]}]};
function Preview(){const [board,setBoard]=useState(initial),[selection,setSelection]=useState(null),[open,setOpen]=useState(true),views=useRef(new Map());
 window.__scenePreview={setBoard,board,selection,setSelection};
 return <><div className="study-screen" style={{width:'100%',height:720,'--stage-content-x':'20px','--stage-content-y':'60px','--stage-content-width':'calc(100% - 40px)','--stage-content-height':'620px','--stage-content-max-width':'min(750px, calc(100vw - 40px))','--stage-close-x':'calc(100% - 55px)','--stage-close-y':'10px'}}>{open&&<Whiteboard interactive={new URLSearchParams(location.search).get('interactive')!=='false'} board={board} viewCache={views.current} selection={selection} onSelect={setSelection} onClose={()=>setOpen(false)}/>}</div><button id="restore" onClick={()=>setOpen(true)}>Restore fixture</button></>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
