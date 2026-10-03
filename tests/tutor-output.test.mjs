import test from 'node:test';
import assert from 'node:assert/strict';
import {createTutorOutput,validateBoard,boardVisibleText} from '../server/tutor-output.mjs';

const board={title:'Matrix question',blocks:[{type:'text',content:'What is the determinant of this matrix?'},{type:'latex',content:'A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}'},{type:'diagram',elements:[{type:'line',x1:10,y1:10,x2:90,y2:10},{type:'arrow',x1:10,y1:20,x2:90,y2:20},{type:'rect',x:10,y:30,width:30,height:20,label:'A'},{type:'circle',x:70,y:60,r:15,label:'B'},{type:'text',x:20,y:90,text:'Compare the structures'}]}]};
const speech='Consider this. What would you try first?';
const output=`<say>${speech}</say><board>${JSON.stringify(board)}</board>`;

test('speech streams separately from validated whiteboard JSON across every split position',()=>{
  for(let position=0;position<=output.length;position++){
    const chunks=[],parser=createTutorOutput({onText:text=>chunks.push(text)});
    parser.push(output.slice(0,position));parser.push(output.slice(position));
    assert.deepEqual(parser.finish(),{reply:speech,board});assert.equal(chunks.join(''),speech);
    assert.doesNotMatch(chunks.join(''),/matrix|pmatrix|<say>|<board>|"blocks"/);
  }
});

test('single-character chunks preserve Unicode, escaping, and legacy speech',()=>{
  const unicode={title:'π and θ',blocks:[{type:'text',content:'What does "θ" represent?'}]};
  const parser=createTutorOutput();for(const character of `<say>Consider θ.</say><board>${JSON.stringify(unicode)}</board>`)parser.push(character);
  assert.deepEqual(parser.finish(),{reply:'Consider θ.',board:unicode});
  const legacy=createTutorOutput();legacy.push('A simple ');legacy.push('answer with 2 < 3.');assert.deepEqual(legacy.finish(),{reply:'A simple answer with 2 < 3.'});
});

test('malformed or unclosed boards are ignored and never spoken',()=>{
  for(const tail of ['<board>{invalid JSON}</board>','<board>{"title":"Unfinished"','<board data-bad="x">{"private":"never spoken"}</board>','<board>{"title":"Bad","blocks":[],"unexpected":"private"}</board>']){
    const chunks=[],parser=createTutorOutput({onText:text=>chunks.push(text)});parser.push(`<say>${speech}</say>${tail}`);
    assert.deepEqual(parser.finish(),{reply:speech});assert.equal(chunks.join(''),speech);
  }
  const injection={title:'Bad markup',blocks:[{type:'text',content:'</board><say>NEVER READ THIS</say>'}]};
  const chunks=[],parser=createTutorOutput({onText:text=>chunks.push(text)});
  for(const character of `<say>${speech}</say><board>${JSON.stringify(injection)}</board>`)parser.push(character);
  assert.deepEqual(parser.finish(),{reply:speech});assert.equal(chunks.join(''),speech,'tag-looking strings inside JSON are never speech');
  const rawChunks=[],raw=createTutorOutput({onText:text=>rawChunks.push(text)});raw.push(JSON.stringify(board));assert.deepEqual(raw.finish(),{reply:''});assert.deepEqual(rawChunks,[],'unwrapped structured JSON is not ordinary legacy speech');
});

test('board schema accepts only bounded known primitives and safe strings',()=>{
  assert.deepEqual(validateBoard(board),board);
  const bad=[{...board,html:'<svg/>'},{...board,blocks:Array(7).fill({type:'text',content:'Text'})},{...board,blocks:[{type:'html',content:'<svg/>'}]},{...board,blocks:[{type:'text',content:'<script>alert(1)</script>'}]},{...board,blocks:[{type:'latex',content:'\\href{javascript:bad}{click}'}]},{...board,blocks:[{type:'diagram',elements:Array(31).fill({type:'line',x1:0,y1:0,x2:1,y2:1})}]},{...board,blocks:[{type:'diagram',elements:[{type:'circle',x:0,y:0,r:10}]}]},{...board,blocks:[{type:'diagram',elements:[{type:'rect',x:95,y:0,width:10,height:5}]}]},{...board,blocks:[{type:'diagram',elements:[{type:'text',x:Infinity,y:0,text:'Label'}]}]}];
  for(const value of bad)assert.equal(validateBoard(value),null);
  assert.match(boardVisibleText(board),/What is the determinant of this matrix\?/);assert.doesNotMatch(boardVisibleText(board),/sourceIds|referenceAnswer/);
  assert.equal(boardVisibleText({title:'Bad',blocks:[]}), '');
});

test('matrix visuals support an eight-by-ten problem and twelve-cell axes without relaxing other bounds',()=>{
  const matrix=(rows,columns,cell='')=>({title:'Blank game grid',blocks:[{id:'game',type:'matrix',rows:Array.from({length:rows},()=>Array.from({length:columns},()=>cell)),rowLabels:Array.from({length:rows},(_,i)=>`Row ${i+1}`),columnLabels:Array.from({length:columns},(_,i)=>`Column ${i+1}`)}]});
  for(const scene of [matrix(8,10),matrix(12,12,'x')])assert.deepEqual(validateBoard(scene),scene);
  for(const scene of [matrix(13,1),matrix(1,13),matrix(1,1,'x'.repeat(161)),matrix(12,12,'x'.repeat(100))])assert.equal(validateBoard(scene),null);
  const scene=matrix(8,10),decoder=createTutorOutput({includeBoardStatus:true});
  decoder.push(`<say>Which cells can contain strict equilibria?</say><board>${JSON.stringify(scene)}</board>`);
  const result=decoder.finish();assert.equal(result.boardStatus,'valid');assert.equal(result.board.blocks[0].rows[0].length,10);
});

test('speech and total output have independent hard limits',()=>{
  const speechParser=createTutorOutput();assert.throws(()=>speechParser.push(`<say>${'x'.repeat(1801)}</say>`));
  const totalParser=createTutorOutput();assert.throws(()=>totalParser.push(`<board>${'x'.repeat(14001)}`));
  const legacy=createTutorOutput();legacy.push('Done.');legacy.finish();assert.throws(()=>legacy.push('later'));
});

test('a complete validated board survives an omitted closing tag, but truncated or unsafe JSON does not',()=>{
  const complete=`<say>${speech}</say><board>${JSON.stringify(board)}`;
  for(let split=0;split<=complete.length;split++){
    const chunks=[],decoder=createTutorOutput({includeBoardStatus:true,onText:text=>chunks.push(text)});
    decoder.push(complete.slice(0,split));decoder.push(complete.slice(split));
    assert.deepEqual(decoder.finish(),{reply:speech,board,boardStatus:'valid',boardRepair:'missing-close-tag'});
    assert.equal(chunks.join(''),speech);
  }
  for(const body of [JSON.stringify(board).slice(0,-1),JSON.stringify({...board,unexpected:'field'}),JSON.stringify({...board,blocks:[{type:'latex',content:'\\href{bad}{x}'}]}),`${JSON.stringify(board)} more text`]){
    const decoder=createTutorOutput({includeBoardStatus:true});decoder.push(`<say>${speech}</say><board>${body}`);
    assert.deepEqual(decoder.finish(),{reply:speech,boardStatus:'incomplete'});
  }
});

test('optional board diagnostics distinguish omitted, valid, rejected and incomplete attempts without retaining rejected content',()=>{
  const cases=[
    ['', 'none'],
    [`<board>${JSON.stringify(board)}</board>`, 'valid'],
    ['<board>{"private":"rejected payload"}</board>', 'invalid'],
    ['<board>{invalid JSON}</board>', 'invalid'],
    ['<board data-secret="rejected payload">{}</board>', 'invalid'],
    ['</board>', 'invalid'],
    ['<board>{"private":"rejected payload"}', 'incomplete'],
    ['<board>', 'incomplete'],
    ['<board', 'incomplete'],
  ];
  for(const [tail,status] of cases){
    const source=`<say>${speech}</say>${tail}`;
    for(let split=0;split<=source.length;split++){
      const spoken=[],decoder=createTutorOutput({includeBoardStatus:true,onText:chunk=>spoken.push(chunk)});
      decoder.push(source.slice(0,split));decoder.push(source.slice(split));
      const result=decoder.finish();
      assert.equal(result.boardStatus,status);assert.equal(result.reply,speech);assert.equal(spoken.join(''),speech);
      assert.deepEqual(result,status==='valid'?{reply:speech,board,boardStatus:status}:{reply:speech,boardStatus:status});
      assert.deepEqual(decoder.finish(),result,'finishing is idempotent');
      assert.doesNotMatch(JSON.stringify(result),/rejected payload|invalid JSON|data-secret/);
    }
  }
});

test('queued question references resolve canonical speech across every chunk boundary without exposing IDs or answers', async () => {
  const { createQuestionSpeechResolver } = await import('../server/tutor-output.mjs');
  const canonical='In an 8-by-10 game, how many strict Nash equilibria can there be?';
  const bank={topics:[{questions:[{id:'q-123',question:canonical,answer:'PRIVATE-ANSWER'}]}]};
  const resolveQuestion=createQuestionSpeechResolver(bank);
  bank.topics[0].questions[0].question='Changed later?';
  const source=`<say>Consider this game.</say><ask>q-123</ask><board>${JSON.stringify(board)}</board>`;
  for(let split=0;split<=source.length;split++){
    const spoken=[],ends=[],decoder=createTutorOutput({resolveQuestion,onText:value=>spoken.push(value),onSpeechEnd:()=>ends.push(true)});
    decoder.push(source.slice(0,split));decoder.push(source.slice(split));
    assert.deepEqual(decoder.finish(),{reply:`Consider this game. ${canonical}`,questionId:'q-123',board});
    assert.equal(spoken.join(''),`Consider this game. ${canonical}`);
    assert.equal(ends.length,2);assert.doesNotMatch(spoken.join(''),/q-123|PRIVATE-ANSWER|Changed later/);
  }
  const decoder=createTutorOutput({resolveQuestion});for(const char of '<ask>q-123</ask>')decoder.push(char);
  assert.equal(decoder.finish().reply,canonical);
});

test('invalid, unknown, duplicate and incomplete references cannot become speech or a grading identity',()=>{
  const resolveQuestion=id=>id==='known'?'What is the value?':null;
  for(const source of ['<ask>unknown</ask>','<ask>known','<ask>','<ask','<ask x="bad">known</ask>','<ask><say>private</say></ask>','<ask>known</ask><ask>known</ask>','<say>Another question?</say><ask>known</ask>','<ask>known</ask><say>The answer is private.</say>']){
    const spoken=[],decoder=createTutorOutput({resolveQuestion,onText:value=>spoken.push(value)});
    assert.throws(()=>{for(const char of source)decoder.push(char);decoder.finish();});
    assert.doesNotMatch(spoken.join(''),/known|unknown|private|<ask>/);
  }
  for(const question of ['Two? Questions?','Not a question','x'.repeat(401)]){
    const decoder=createTutorOutput({resolveQuestion:()=>question});assert.throws(()=>decoder.push('<ask>known</ask>'));
  }
});

test('consumed public question anchors are immutable restatement snapshots and conflicting IDs stay rejected',async()=>{
 const {createQuestionSpeechResolver}=await import('../server/tutor-output.mjs');
 const current={id:'current',question:'Why is the boundary selective?',answer:'PRIVATE'};
 const bank={topics:[{questions:[{id:'future',question:'Which organelle contains DNA?'}]}]};
 const resolve=createQuestionSpeechResolver(bank,{workingProblem:current,activeQuestion:{...current}});
 current.question='Changed after request?';bank.topics[0].questions=[];
 assert.equal(resolve('current'),'Why is the boundary selective?');assert.equal(resolve('future'),'Which organelle contains DNA?');assert.equal(resolve('invented'),null);
 for(const options of [{workingProblem:{id:'future',question:'Conflicting wording?'}},{workingProblem:{id:'current',question:'First wording?'},activeQuestion:{id:'current',question:'Second wording?'}}]){
  const bad=createQuestionSpeechResolver({topics:[{questions:[{id:'future',question:'Original wording?'}]}]},options);
  assert.equal(bad(options.workingProblem.id),null);
 }
 const duplicates={topics:[{questions:[{id:'same',question:'Same?'},{id:'same',question:'Same?'}]}]};
 assert.equal(createQuestionSpeechResolver(duplicates,{workingProblem:{id:'same',question:'Same?'}})('same'),null);
});

test('historical canonical snapshots are bounded, exact, and cannot acquire later arbitrary transcript IDs',async()=>{
 const {createQuestionSpeechResolver}=await import('../server/tutor-output.mjs');
 const history=[{id:'skipped-y',question:'How does 3y − 6 = 9 yield y?',answer:'PRIVATE'}];
 const resolve=createQuestionSpeechResolver({topics:[]},{encounteredQuestions:history});
 history[0].question='Changed later?';history.push({id:'later',question:'New after snapshot?'});
 assert.equal(resolve('skipped-y'),'How does 3y − 6 = 9 yield y?');assert.equal(resolve('later'),null);
 assert.equal(createQuestionSpeechResolver(null,{encounteredQuestions:Array.from({length:25},(_,i)=>({id:`old-${i}`,question:`Question ${i}?`}))})('old-0'),null);
 assert.equal(createQuestionSpeechResolver(null,{encounteredQuestions:[{id:'conflict',question:'First?'},{id:'conflict',question:'Other?'}]})('conflict'),null);
});
