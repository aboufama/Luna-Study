import {validateRetainedScene} from '../shared/retained-scene.mjs';
import {validateInteractionZones} from '../shared/board-parts.mjs';

const writing=(id,text,x,y,width=660,height=52,extra={})=>({id,type:'text',x,y,width,height,text,fontSize:22,...extra});
const math=(id,text,x,y,width=500,height=68,extra={})=>writing(id,text,x,y,width,height,{type:'math',fontSize:32,...extra});
const line=(id,x1,y1,x2,y2,extra={})=>({id,type:'line',x1,y1,x2,y2,...extra});
const box=(id,x,y,width,height,label,extra={})=>({id,type:'rect',x,y,width,height,label,...extra});
const zone=(id,label,objectId,quote)=>({id,label,anchor:{kind:'object',id:objectId,...(quote?{quote}:{})}});
const scene=(id,objects,zones)=>({id,type:'scene',width:800,height:500,objects,...(zones?{zones}:{})});

export const demoSubjects=[
  {id:'biology',label:'Biology',eyebrow:'Structure & function',description:'Explore a cell, then change one part without redrawing the rest.',examples:[
    {title:'Inside an animal cell',prompt:'Where does the nucleus sit inside the cell?',reply:'The cell membrane encloses the cytoplasm. The nucleus is one structure inside it.',hint:'Select the nucleus. Then move it and notice that only that object changes.',action:'Move the nucleus',updateReply:'The nucleus moved. The membrane and cytoplasm are still the same objects.',annotation:'The nucleus contains most of the cell’s DNA.',board:scene('animal-cell',[
      writing('heading','An animal cell',50,32,600,42,{fontSize:28}),
      {id:'membrane',type:'ellipse',x:100,y:110,width:490,height:300,tone:'accent'},
      writing('cytoplasm','Cytoplasm',140,315,200,40,{tone:'muted'}),
      {id:'nucleus',type:'ellipse',x:290,y:180,width:150,height:110,label:'Nucleus',tone:'accent'},
      line('membrane-pointer',570,170,650,132,{tone:'muted'}),
      writing('membrane-label','Cell membrane',603,87,167,55,{fontSize:18}),
    ]),updates:[{id:'nucleus',type:'ellipse',x:370,y:225,width:150,height:110,label:'Nucleus',tone:'accent'}]},
    {title:'Diffusion across a membrane',prompt:'Which way do particles move overall?',reply:'Particles move in both directions. Net movement is from higher to lower concentration.',hint:'The arrow represents net movement, not the path of every particle.',action:'Add the net movement',updateReply:'The new arrow makes the net direction explicit.',annotation:'At equilibrium, particles still move, but there is no net movement.',board:scene('diffusion',[
      writing('heading','Diffusion',50,32,500,42,{fontSize:28}),
      writing('high','Higher concentration',65,103,300,42),writing('low','Lower concentration',450,103,300,42),
      line('membrane',400,150,400,378,{tone:'accent'}),writing('membrane-label','Permeable membrane',260,390,340,40,{fontSize:18,tone:'muted'}),
      ...[[125,200],[225,180],[310,230],[165,285],[280,310],[510,250],[640,300]].map(([x,y],i)=>({id:`particle-${i}`,type:'ellipse',x,y,width:20,height:20,tone:'accent'})),
    ]),updates:[{id:'net',type:'arrow',x1:250,y1:355,x2:570,y2:355,label:'Net movement',tone:'accent'}]},
  ]},
  {id:'algebra',label:'Algebra',eyebrow:'Reasoning, made visible',description:'Follow a worked step and select the exact part you want to discuss.',examples:[
    {title:'Keep both sides balanced',prompt:'How would you begin solving 2x + 4 = 10?',reply:'Subtract four from both sides. Doing the same thing to each side preserves the equality.',hint:'Select “2x” or “+ 4” in the equation. Both are exact math targets.',action:'Show the next step',updateReply:'Now the constant is removed from the left side. The original equation stays in place.',annotation:'Next, divide both sides by 2 to get x = 3.',board:scene('linear-equation',[
      writing('heading','Keep the equation balanced',50,32,700,44,{fontSize:28}),
      math('equation','2x + 4 = 10',90,133,560,72,{fontSize:42}),
      writing('instruction','Subtract 4 from both sides.',90,225,620,48,{tone:'muted'}),
      math('operation','2x + 4 - 4 = 10 - 4',90,292,610,64),
    ],[zone('term','Variable term','equation','2x'),zone('constant','Added constant','equation','+ 4'),zone('right','Right side','equation','10'),zone('operation-zone','Subtract four on both sides','operation')]),updates:[math('next-step','2x = 6',90,375,550,60,{tone:'accent'})]},
    {title:'Distribute to every term',prompt:'What does 3(x + 2) mean?',reply:'The factor three multiplies both terms inside the parentheses.',hint:'Select the expression, then show its expanded form.',action:'Show the expansion',updateReply:'Both terms were multiplied by three. The two expressions are equivalent.',annotation:'Check with x = 1: both forms equal 9.',board:scene('distribute',[
      writing('heading','Distribute across the parentheses',50,32,700,44,{fontSize:28}),
      math('expression','3(x + 2)',90,140,500,75,{fontSize:42}),
      writing('instruction','Multiply each term inside by 3.',90,240,620,48,{tone:'muted'}),
    ],[zone('factor','Outside factor','expression','3'),zone('inside','Inside the parentheses','expression','x + 2')]),updates:[math('expanded','3x + 6',90,330,550,70,{tone:'accent'})]},
  ]},
  {id:'physics',label:'Physics',eyebrow:'Forces & motion',description:'Compare directions and magnitudes in a stable, selectable scene.',examples:[
    {title:'Forces on a sliding block',prompt:'What changes if the push becomes stronger?',reply:'The net horizontal force is the push to the right minus friction to the left.',hint:'The arrow lengths share a scale. Increase the push and compare them.',action:'Increase the push',updateReply:'The push increased from 8 N to 12 N. Friction stays at 4 N, so the net force is 8 N rightward.',annotation:'Acceleration follows the net force: a = Fnet / m.',board:scene('horizontal-forces',[
      writing('heading','Horizontal forces',50,32,700,44,{fontSize:28}),
      box('block',325,205,150,100,'2 kg'),line('surface',70,310,735,310,{tone:'muted'}),
      {id:'friction',type:'arrow',x1:325,y1:255,x2:225,y2:255,label:'4 N friction',tone:'muted'},
      {id:'push',type:'arrow',x1:475,y1:255,x2:675,y2:255,label:'8 N push',tone:'accent'},
      writing('scope','Horizontal forces only; vertical forces balance.',90,355,630,45,{fontSize:19,tone:'muted'}),
    ]),updates:[{id:'push',type:'arrow',x1:475,y1:255,x2:775,y2:255,label:'12 N push',tone:'accent'}]},
    {title:'Balanced vertical forces',prompt:'Does zero net force mean the forces disappear?',reply:'No. The table pushes up while gravity pulls down. Equal opposing forces give zero net force.',hint:'Each arrow has the same length. Select either force to inspect its label.',action:'Write the force balance',updateReply:'The forces cancel vertically, so vertical acceleration is zero.',annotation:'Zero acceleration means constant velocity, which can include rest.',board:scene('vertical-forces',[
      writing('heading','Balanced vertical forces',50,30,700,44,{fontSize:28}),
      box('block',330,222,140,70,'Book'),
      {id:'normal',type:'arrow',x1:400,y1:222,x2:400,y2:112,label:'10 N normal',tone:'accent'},
      {id:'weight',type:'arrow',x1:400,y1:292,x2:400,y2:402,label:'10 N weight',tone:'muted'},
    ]),updates:[math('balance','F_y = 10 - 10 = 0',50,345,285,58,{fontSize:24})]},
  ]},
  {id:'grammar',label:'Grammar',eyebrow:'Language in context',description:'Point to meaningful phrases rather than isolated, arbitrary words.',examples:[
    {title:'Two clauses, one sentence',prompt:'Which part of this sentence can stand alone?',reply:'“We went outside” is an independent clause. The opening clause depends on it.',hint:'Select either clause in the sentence. Try selecting both, then press Escape.',action:'Label the clauses',updateReply:'The opening clause sets the time. The independent clause carries the main statement.',annotation:'The comma separates this introductory dependent clause from the main clause.',board:scene('sentence-clauses',[
      writing('heading','Find the clauses',50,32,700,44,{fontSize:28}),
      writing('sentence','After the rain stopped, we went outside.',60,155,700,85,{fontSize:30}),
      writing('instruction','Which words form a complete thought?',60,286,670,64,{fontSize:22,tone:'muted'}),
    ],[zone('dependent','Dependent clause','sentence','After the rain stopped'),zone('independent','Independent clause','sentence','we went outside')]),updates:[writing('dependent-label','Dependent clause → sets the time',60,345,650,40,{fontSize:20,tone:'accent'}),writing('independent-label','Independent clause → a complete thought',60,392,690,40,{fontSize:20,tone:'accent'})]},
    {title:'Subject and predicate',prompt:'Who is doing something, and what are they doing?',reply:'“The curious student” is the subject. “Asked a thoughtful question” is the predicate.',hint:'Select each phrase to inspect the exact wording and its role.',action:'Add the roles',updateReply:'The subject names who the sentence is about. The predicate says what that subject did.',annotation:'A simple declarative sentence combines a subject with a predicate.',board:scene('sentence-roles',[
      writing('heading','Subject + predicate',50,32,700,44,{fontSize:28}),
      writing('sentence','The curious student asked a thoughtful question.',60,155,700,90,{fontSize:28}),
      writing('instruction','Who? What did they do?',60,286,670,54,{tone:'muted'}),
    ],[zone('subject','Subject','sentence','The curious student'),zone('predicate','Predicate','sentence','asked a thoughtful question')]),updates:[writing('subject-label','Subject → The curious student',60,345,670,40,{fontSize:20,tone:'accent'}),writing('predicate-label','Predicate → asked a thoughtful question',60,392,690,40,{fontSize:20,tone:'accent'})]},
  ]},
];

export function validatedDemoScene(block){
  const valid=validateRetainedScene(block,{stored:true});
  if(!valid||!validateInteractionZones(valid))throw new Error('Invalid scripted demo scene.');
  return valid;
}
export function demoBoard(example,revision){return {title:example.title,revision,blocks:[validatedDemoScene(example.board)]};}
export function patchDemoBoard(board,objects,revision){
  const scene=board.blocks[0],updates=new Map(objects.map(object=>[object.id,object]));
  const next=scene.objects.map(object=>updates.get(object.id)||object);
  for(const object of objects)if(!scene.objects.some(prior=>prior.id===object.id))next.push(object);
  const zones=scene.zones&&[...scene.zones];
  if(zones)for(const object of objects)if(!zones.some(zone=>zone.anchor.id===object.id))zones.push(zone(`${object.id}-zone`,object.text.slice(0,100),object.id));
  return {...board,revision,blocks:[validatedDemoScene({...scene,objects:next,...(zones?{zones}:{})})]};
}
export function demoAnnotation(example){return writing('teaching-note',example.annotation,50,449,700,43,{fontSize:17,tone:'accent'});}
