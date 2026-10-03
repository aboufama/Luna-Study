const board=blocks=>({title:'Study scene',mode:'replace',blocks});
const latex=(id,content)=>({id,type:'latex',content});
const text=(id,content)=>({id,type:'text',content});
const matrix=(id,rows,columns)=>({id,type:'matrix',size:[rows,columns]});
const scene=(id,objects)=>({id,type:'scene',width:800,height:500,objects});
const animal=scene('animal',[{id:'membrane',type:'ellipse',x:100,y:70,width:600,height:350,label:'Cell membrane'},{id:'nucleus',type:'ellipse',x:330,y:180,width:140,height:120,label:'Nucleus'}]);
const plant=scene('plant',[{id:'wall',type:'rect',x:100,y:70,width:600,height:350,label:'Cell wall'},{id:'chloroplast',type:'ellipse',x:190,y:180,width:100,height:60,label:'Chloroplast'}]);
const timeline=(id,events)=>scene(id,[{id:'axis',type:'line',x1:50,y1:250,x2:750,y2:250},...events.flatMap(([name,year,x],index)=>[{id:`tick-${index}`,type:'line',x1:x,y1:240,x2:x,y2:260},{id:`label-${index}`,type:'text',x:Math.max(0,x-70),y:280,width:140,height:80,text:`${name}\n${year}`,fontSize:18}])]);
const targetTimeline=timeline('us-timeline',[['Declaration',1776,70],['Constitution',1787,554],['Bill of Rights',1791,730]]);
const otherTimeline=timeline('fr-timeline',[['French Revolution',1789,70],['Napoleon crowned',1804,451],['Waterloo',1815,730]]);
const annotation=(id,sentence,first,last)=>({id,type:'annotation',text:sentence,spans:[{quote:first,label:'Clause A'},{quote:last,label:'Clause B'}]});
const targetSentence=annotation('sentence','Although it rained, Maya walked home.','Although it rained','Maya walked home');
const otherSentence=annotation('other-sentence','When the bell rang, Liam left.','When the bell rang','Liam left');

// Fixed before any paid classification. Development and held-out domains are
// disjoint. These labels concern target relevance, not permission to disclose
// an answer or scientific correctness of every possible rendered diagram.
const families=[
  {split:'development',subject:'game-grid',question:'In a 3-row, 5-column game, which cells could be strict Nash equilibria? Inspect the blank grid without inventing payoff values.',
    positive:[matrix('grid',3,5)],wrong:[matrix('grid',3,4)],mixed:[matrix('grid',3,5),matrix('old-grid',2,2)],incomplete:[text('note','Compare each player’s best responses.')]},
  {split:'development',subject:'algebra',question:'How do equal operations solve 3y - 6 = 9, and why are those operations valid?',
    positive:[latex('equation','3y-6=9')],wrong:[latex('equation','2x+3=11\\Rightarrow x=4')],mixed:[latex('new-equation','3y-6=9'),latex('old-solution','2x+3=11\\Rightarrow x=4')],incomplete:[text('rule','Use equal operations on both sides.')]},
  {split:'development',subject:'biology',question:'Using the animal-cell diagram, identify the nucleus inside the cell membrane.',
    positive:[animal],wrong:[plant],mixed:[animal,plant],incomplete:[scene('cell',[{id:'outline',type:'ellipse',x:100,y:70,width:600,height:350}])]},
  {split:'held-out',subject:'chemistry',question:'For the reaction 2H2 + O2 → 2H2O, how are hydrogen and oxygen atoms conserved?',
    positive:[latex('reaction','2H_2+O_2\\rightarrow2H_2O')],wrong:[latex('reaction','C+O_2\\rightarrow CO_2')],mixed:[latex('reaction','2H_2+O_2\\rightarrow2H_2O'),latex('old-reaction','C+O_2\\rightarrow CO_2')],incomplete:[text('principle','Atoms are conserved in a chemical reaction.')]},
  {split:'held-out',subject:'history',question:'On the timeline, compare the Declaration in 1776, the Constitution in 1787, and the Bill of Rights in 1791.',
    positive:[targetTimeline],wrong:[otherTimeline],mixed:[targetTimeline,otherTimeline],incomplete:[scene('timeline',[{id:'axis',type:'line',x1:50,y1:250,x2:750,y2:250}])]},
  {split:'held-out',subject:'grammar',question:'In “Although it rained, Maya walked home.”, identify the dependent clause and the main clause.',
    positive:[targetSentence],wrong:[otherSentence],mixed:[targetSentence,otherSentence],incomplete:[text('definition','A dependent clause cannot stand alone as a complete sentence.')]},
];
export const calibrationFixtures=families.flatMap(family=>['positive','wrong','mixed','incomplete'].map(kind=>({id:`${family.subject}-${kind}`,split:family.split,subject:family.subject,kind,question:family.question,expectedDisplay:kind==='positive',labelReason:kind==='positive'?'All concrete target givens are present; a solution is not required for relevance.':kind==='wrong'?'The candidate depicts a different target.':kind==='mixed'?'The candidate includes a prior/different target alongside the new one.':'Generic or missing givens do not identify the exact target confidently.',board:board(family[kind])})));
