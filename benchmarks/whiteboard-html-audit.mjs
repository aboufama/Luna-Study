// Offline DOM audit of retained HTML outputs. Never invokes a model/provider.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {parseHtmlFormat,htmlDocument} from './whiteboard-html.mjs';
const dir=new URL('./whiteboard-formats/',import.meta.url),file=name=>new URL(name,dir);
const manualReviews={"payoff-matrix-html-1":{"rawSha256":"783a8b87e8d83c694631f79c7e25179dfa20e42e449a015c870bc0486015f74b","passed":true,"notes":["All four payoff tuples appear in the correct physical cells; row and column labels are readable."]},"blank-grid-html-1":{"rawSha256":"0c6c3efeb7d7283c3dc13b1f2541f8ca4dad48b60d7439b402ba00b95dc45ac0","passed":true,"notes":["Exact blank8\u00d710 grid and all row/column labels are visually correct."]},"line-city-html-1":{"rawSha256":"408368e6c01af3106e57583572ec9abe1fb8eae0be2af7af43edeb0d63596b66","passed":true,"notes":["Vendor tick markers lie at0.2 and0.8 on the same axis; circular markers are not required."]},"game-tree-html-1":{"rawSha256":"67aea6d0091c4df8b7ca754df5420632174b970417dad4c144af18037a26a51d","passed":true,"notes":["All branches connect to the intended decisions and leaf payoffs; action labels retain case and do not obscure the branches."]},"function-plot-html-1":{"rawSha256":"a17f16da550e7d272d3803171eeee66d6b1f2ae226028bc1977803b6b18b9a6d","passed":false,"notes":["Right-hand curve segments begin at the wrong y positions, fail to connect the listed sample points, and one segment extends above the frame. The labels and five point markers alone are correct."]},"process-html-1":{"rawSha256":"46242a5e40a1a6e3ac357430f4e19791f435514c6bab6ff50f5dcf299514379a","passed":false,"notes":["The return connector stops about20px below Observe. Its two arrowhead strokes form an X rather than an upward arrowhead. The forward stages and connectors are readable."]},"patch-city-html-1":{"rawSha256":"efab6a0b134fd4e94e5e0cba230903f1495cdb87828132447ba8088bcf09a635","passed":true,"notes":["A moves to0.3 while B, endpoints, axis and identity names remain stable."]}};
const report=JSON.parse(await readFile(file('html-results.json'),'utf8'));
const audit={completedAt:null,providerCalls:0,externalBrowserRequests:[],runs:[],notes:['Retained raw HTML is revalidated and measured without repairs.','Initial checks remain preserved; this audit adds actual viewport bounds, CSS-transform-aware text sizes, physical cell order/hit areas, and tick/circle city markers.','Edge attachment, mathematical curves, contrast and arrow visibility still require independent visual inspection.']};
await mkdir(file('screenshots/'),{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:800,height:500}});
await page.route('**/*',r=>{audit.externalBrowserRequests.push(r.request().url());return r.abort()});
await page.setContent('<!doctype html><body style="margin:0"><iframe id="frame" sandbox="allow-same-origin" style="width:800px;height:500px;border:0;display:block"></iframe></body>');
const near=(a,b,t=.2)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=t;
function orderedCells(cells,rows,cols) {
 const selected=Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>cells.find(x=>x.row===r&&x.col===c)));
 return selected.flat().every(Boolean)&&selected.every((row,r)=>row.every((cell,c)=>cell.width>5&&cell.height>5&&near(cell.cx,selected[0][c].cx,1)&&near(cell.cy,row[0].cy,1)&&(c===0||cell.x>=row[c-1].x+row[c-1].width-1)&&(r===0||cell.y>=selected[r-1][c].y+selected[r-1][c].height-1)));
}
function cityGeometry(render,expected) {
 const axes=render.geometry.filter(s=>s.width>250&&s.height>0&&s.height<=5).sort((a,b)=>b.width-a.width),axis=axes[0];
 const markers=render.geometry.filter(s=>s.width>=2&&s.width<=30&&s.height>=2&&s.height<=30&&((s.width<=8&&s.height>=8)||(Math.abs(s.width-s.height)<2&&parseFloat(s.borderRadius)>=s.width/3)));
 const find=name=>{let chosen=null,best=Infinity;const labels=render.texts.filter(t=>name==='0'||name==='1'?t.text===name:new RegExp(`\\b${name}\\b`).test(t.text));for(const m of markers){if(axis&&Math.abs(m.cy-axis.cy)>4)continue;for(const t of labels){const distance=Math.hypot(m.cx-t.cx,m.cy-t.cy);if(distance<best){chosen=m;best=distance}}}return best<130?chosen:null;};
 const A=find('A'),B=find('B'),start=find('0'),end=find('1');
 return {valid:Boolean(axis&&A&&B&&A!==B&&near(A.cy,axis.cy,3)&&near(B.cy,axis.cy,3)&&near((A.cx-axis.x)/axis.width,expected,.01)&&near((B.cx-axis.x)/axis.width,.8,.01)),axis,A,B,start,end};
}
function equalBox(a,b) {return Boolean(a&&b&&['x','y','width','height'].every(k=>near(a[k],b[k])));}
try{
 for(const record of report.runs.filter(r=>r.status==='rendered')) {
  const parsed=parseHtmlFormat(record.raw);if(!parsed.valid){audit.runs.push({id:record.id,revalidation:false,errors:parsed.errors});continue;}
  const measured=await page.evaluate(async docHtml=>{
   const frame=document.querySelector('iframe');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Frame timeout')),5000);frame.onload=()=>{clearTimeout(timer);resolve()};frame.srcdoc=docHtml});
   const doc=frame.contentDocument,win=frame.contentWindow,root=doc.querySelector('[data-board-root]');await doc.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
   const rootBox=root.getBoundingClientRect(),bounds={x:rootBox.x,y:rootBox.y,width:rootBox.width,height:rootBox.height};
   const box=el=>{const r=el.getBoundingClientRect();return{x:r.x-rootBox.x,y:r.y-rootBox.y,width:r.width,height:r.height,cx:r.x-rootBox.x+r.width/2,cy:r.y-rootBox.y+r.height/2}};
   const minimumScale=el=>{let m=new win.DOMMatrix();for(let current=el;current&&current!==doc.documentElement;current=current.parentElement){const t=win.getComputedStyle(current).transform;if(t!=='none')m=new win.DOMMatrix(t).multiply(m);}const trace=m.a*m.a+m.b*m.b+m.c*m.c+m.d*m.d,det=m.a*m.d-m.b*m.c;return Math.sqrt(Math.max(0,(trace-Math.sqrt(Math.max(0,trace*trace-4*det*det)))/2));};
   const texts=[],walker=doc.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode,text=node.textContent.trim();if(!text||node.parentElement.closest('style'))continue;const range=doc.createRange();range.selectNodeContents(node);const css=win.getComputedStyle(node.parentElement),scale=minimumScale(node.parentElement);texts.push({text,id:node.parentElement.closest('[id]')?.id||null,...box(range),fontSize:parseFloat(css.fontSize),effectiveFontSize:parseFloat(css.fontSize)*scale,color:css.color,background:css.backgroundColor});}
   const geometry=[...root.querySelectorAll('*')].filter(el=>el.tagName!=='STYLE').map(el=>{const css=win.getComputedStyle(el);return{id:el.id||null,ownerId:el.closest('[id]')?.id||null,tag:el.tagName.toLowerCase(),...box(el),borderRadius:css.borderRadius,borderTopWidth:css.borderTopWidth,borderRightWidth:css.borderRightWidth,borderBottomWidth:css.borderBottomWidth,borderLeftWidth:css.borderLeftWidth,background:css.backgroundColor,transform:css.transform}});
   const cells=[...root.querySelectorAll('[id]')].filter(el=>/-cell-(?:r)?\d+-(?:c)?\d+$/.test(el.id)).map(el=>{const r=el.getBoundingClientRect();const coord=el.id.match(/-cell-(?:r)?(\d+)-(?:c)?(\d+)$/);return{id:el.id,row:+coord[1],col:+coord[2],...box(el),text:el.textContent.trim(),hits:[[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]].map(([x,y])=>{const hit=doc.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return Boolean(hit&&(hit===el||el.contains(hit)))})};});
   const overlaps=[];for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){const a=texts[i],b=texts[j],w=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),h=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);if(w>2&&h>2&&w*h>Math.min(a.width*a.height,b.width*b.height)*.12)overlaps.push({a:a.text,b:b.text});}
   return {bounds,texts,geometry,cells,overlappingLabels:overlaps};
  },htmlDocument(parsed));
  const checks={...record.checks,correctRootDimensions:near(measured.bounds.x,0,.5)&&near(measured.bounds.y,0,.5)&&near(measured.bounds.width,800,.5)&&near(measured.bounds.height,500,.5),readableLabels:measured.texts.every(t=>t.effectiveFontSize>=11),noClippedLabels:measured.texts.every(t=>t.x>=-.5&&t.y>=-.5&&t.x+t.width<=800.5&&t.y+t.height<=500.5),noOverlappingLabels:measured.overlappingLabels.length===0};
  if(record.scenario==='payoff-matrix'){checks.physical2By2=orderedCells(measured.cells,2,2);checks.cellHitTargets=measured.cells.length===4&&measured.cells.every(c=>c.hits.every(Boolean));checks.correctPayoffCellPlacement=checks.correctPayoffCellPlacement&&checks.physical2By2;}
  if(record.scenario==='blank-grid'){checks.exact80Cells=measured.cells.length===80&&new Set(measured.cells.map(c=>`${c.row}:${c.col}`)).size===80&&measured.cells.every(c=>c.row>=0&&c.row<8&&c.col>=0&&c.col<10);checks.physical8By10=orderedCells(measured.cells,8,10);checks.cellHitTargets=measured.cells.length===80&&measured.cells.every(c=>c.hits.every(Boolean));}
  let city;
  if(record.scenario==='line-city'||record.scenario==='patch-city') {city=cityGeometry(measured,record.scenario==='line-city'?.2:.3);checks.correctSharedCityGeometry=city.valid;if(record.scenario==='patch-city'){const prior=audit.runs.find(r=>r.id==='line-city-html-1')?.city;checks.unchangedCityAndB=equalBox(prior?.axis,city.axis)&&equalBox(prior?.B,city.B);checks.unchangedEndpointGeometry=equalBox(prior?.start,city.start)&&equalBox(prior?.end,city.end);}}
  const knownReview=manualReviews[record.id];const manualReview=knownReview?.rawSha256===createHash('sha256').update(record.raw).digest('hex')?knownReview:null;
  const screenshot=`screenshots/html-${record.id}.png`;await page.locator('iframe').screenshot({path:file(screenshot).pathname});
  audit.runs.push({id:record.id,revalidation:true,checks,city,visualAudit:measured,screenshot,manualReview});
 }
} finally {await browser.close();}
audit.completedAt=new Date().toISOString();await writeFile(file('html-visual-audit.json'),JSON.stringify(audit,null,2)+'\n');
// Do not overwrite an active producer. Merge only into its completed final report.
const latest=JSON.parse(await readFile(file('html-results.json'),'utf8'));
if(latest.finishedAt){for(const result of audit.runs){const record=latest.runs.find(r=>r.id===result.id);if(!record||!result.revalidation)continue;record.initialChecks??=record.checks;record.checks=result.checks;record.visualAudit=result.visualAudit;record.screenshot=result.screenshot;if(result.manualReview)record.manualReview=result.manualReview;if(result.city)record.city=result.city;}latest.geometryAudit={completedAt:audit.completedAt,providerCalls:0,externalBrowserRequests:audit.externalBrowserRequests,notes:audit.notes};await writeFile(file('html-results.json'),JSON.stringify(latest,null,2)+'\n');}
console.log(JSON.stringify({audited:audit.runs.length,merged:Boolean(latest.finishedAt),providerCalls:0,externalBrowserRequests:audit.externalBrowserRequests,concerns:audit.runs.map(r=>({id:r.id,checks:Object.entries(r.checks||{}).filter(([,v])=>!v).map(([k])=>k)})).filter(r=>r.checks.length)}));
