import test from 'node:test';
import assert from 'node:assert/strict';
import {boardTextParts,renderBoardInlineMath,matrixCellIsMath,matrixProseColumns} from '../shared/board-rich-text.mjs';

test('the reported hydraulic legend renders four inline symbols without losing text',()=>{
  const text=String.raw`\(\rho\): fluid density · \(g\): gravity · \(H\): head · \(Q\): volume flow rate`;
  const parts=boardTextParts(text);
  assert.deepEqual(parts.filter(p=>p.type==='math').map(p=>p.text),[String.raw`\rho`,'g','H','Q']);
  assert.equal(parts.filter(p=>p.type==='text').map(p=>p.text).join(''),': fluid density · : gravity · : head · : volume flow rate');
  for(const p of parts.filter(p=>p.type==='math'))assert.match(renderBoardInlineMath(p.text),/class="katex"/);
});

test('inline formulas, display math and surrounding prose preserve exact source',()=>{
  const parts=boardTextParts(String.raw`Energy $E=mc^2$ and \[a^2+b^2=c^2\] remain equations.`);
  assert.equal(parts.filter(p=>p.type==='math').length,2);
  assert.equal(parts.find(p=>p.display)?.text,'a^2+b^2=c^2');
  assert.match(renderBoardInlineMath('a^2+b^2=c^2',{display:true}),/katex-display/);
});

test('ordinary currency, unmatched and escaped delimiters remain literal',()=>{
  for(const value of ['It costs $5.', '$5$ is a price.',String.raw`Unclosed \(x+1`,String.raw`Escaped \\(x\\)`, 'Use <script> literally.'])assert.deepEqual(boardTextParts(value),[{type:'text',text:value}]);
});

test('image, URL and HTML commands cannot produce active content in inline math',()=>{
  for(const value of [String.raw`\href{javascript:alert(1)}{x}`,String.raw`\includegraphics{https://outside.example/a}`,String.raw`\htmlClass{owned}{x}`]){
    const markup=renderBoardInlineMath(value);
    assert.doesNotMatch(markup,/<(?:a|img|script)\b|class="owned"|href="/i);
  }
});

test('mixed teaching tables preserve prose spaces while retaining formulas and payoffs',()=>{
  for(const cell of ['hydraulic power','gravitational acceleration','evaporation','Price in dollars',String.raw`\(Q\): flow rate`,'Correct 2 of 3','细胞膜','скорость потока'])assert.equal(matrixCellIsMath(cell),false,cell);
  for(const cell of [String.raw`\rho`,String.raw`\frac{a}{b}`,'(2, 3)','x^2','Q','0.76'])assert.equal(matrixCellIsMath(cell),true,cell);
});
test('prose sizing follows complete columns without enlarging blank, numeric, or explicit-math grids',()=>{
  assert.deepEqual(matrixProseColumns([['Controls what crosses','',''],['','Down a concentration gradient','No energy input']]),[true,true,true]);
  assert.deepEqual(matrixProseColumns([['(2, 3)',String.raw`\(4,5\)`],['',String.raw`\frac{1}{2}`]]),[false,false]);
  assert.deepEqual(matrixProseColumns([['细胞膜','0.76'],[String.raw`\(Q\): flow rate`,'x^2']]),[true,false]);
});

test('the saved live equation JSON uses single command backslashes after decoding',()=>{
  // Literal JSON escapes are not literal double backslashes in the math source.
  const payload=String.raw`{"content":"2x + 3 - 3 = 11 - 3 \\quad\\Rightarrow\\quad 2x = 8"}`;
  const {content}=JSON.parse(payload);
  assert.deepEqual(content.match(/\\+/g).map(run=>run.length),[1,1,1]);
  const markup=renderBoardInlineMath(content,{display:true}),visible=markup.replace(/<[^>]*>/g,'');
  assert.match(visible,/⇒/);assert.doesNotMatch(visible,/quad|Rightarrow/);assert.doesNotMatch(markup,/katex-error/);
  const completed=String.raw`2x+3=11\quad\Rightarrow\quad2x=8\quad\Rightarrow\quad x=4`;
  assert.equal((renderBoardInlineMath(completed).replace(/<[^>]*>/g,'').match(/⇒/g)||[]).length,2);
});

test('valid TeX array row breaks stay distinct from JSON command escaping',()=>{
  const content=String.raw`\begin{array}{cc}a&b\\c&d\end{array}`;
  assert.ok(content.includes(String.raw`\\`));
  const markup=renderBoardInlineMath(content,{display:true});
  assert.doesNotMatch(markup,/katex-error/);assert.match(markup,/mtable/);
  assert.match(markup.replace(/<[^>]*>/g,''),/a[\s\S]*c[\s\S]*b[\s\S]*d/);
});
