// Re-evaluate retained provider output without regeneration or retiming it.
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {renderCode} from './whiteboard-code-render.mjs';
const dir=new URL('./whiteboard-code/',import.meta.url),browser=await chromium.launch({headless:true});
const failures={
 'game-tree-react-1':['Root action labels L/R were changed to left/right.'],
 'game-tree-canvas-1':['Several selectable identities are registered twice. Rendering is correct, but the one-region-per-ID contract is violated.'],
 'chemistry-equation-react-1':['The two H–O–H product molecules touch/overlap at the adjacent H labels.'],
 'physics-forces-canvas-1':['The model leaves fillStyle white after drawing the block, making all force labels and equations invisible. Presence in draw calls is not visible correctness.'],
 'history-timeline-react-1':['The right event callout border extends past the 800px canvas. Dates/positions/label text otherwise match.'],
 'grammar-annotation-react-1':['The displayed sentence omits the space after the comma (raining,Maya). Exact sentence was requested.'],
};
const notes={
 'biology-cell-react-1':['Compartments and note visible; membrane leader terminates slightly inside the boundary.'],
 'chemistry-equation-canvas-1':['Correct counts and subscripts; product bonds are close to the O glyphs.'],
 'blank-grid-canvas-1':['Problem/player headings are source-grounded and outside empty cells; original noInventedCellValues failure was a check bug.'],
};
const out={providerCalls:0,method:'All26 screenshots visually inspected. Canvas output re-rendered offline for corrected native font bounds and fill color. No original raw, status, timing, usage or checks overwritten. qualityPass requires original/refined automatic checks plus visible content/geometry review. Single samples are not general reliability rates.',runs:[]};
try{
 for(const file of ['results.json','universal-results.json']){
  const source=JSON.parse(await readFile(new URL(file,dir),'utf8'));
  for(const original of source.runs){
   const r={id:original.id,scenario:original.scenario,format:original.format,originalChecks:original.checks,checks:{...original.checks},issues:failures[original.id]||[],notes:notes[original.id]||[]};
   if(original.status==='rendered'&&original.format==='canvas'){
    const refined=await renderCode(browser,'canvas',original.raw,{screenshot:new URL(`audit-${original.id}.png`,dir).pathname});r.render=refined.render;
    r.checks.noClippedLabels=r.render.clippedLabels.length===0;r.checks.readableLabels=r.render.smallLabels.length===0;
    r.checks.visibleInk=r.render.texts.every(t=>!['#ffffff','#fff','white'].includes(String(t.color).toLowerCase())&&t.alpha>0);
    if(original.scenario==='blank-grid'){
     const cells=r.render.hits.filter(h=>/cell/i.test(h.id));
     r.checks.noInventedCellValues=!r.render.texts.some(t=>cells.some(c=>t.x+t.width/2>c.x+1&&t.x+t.width/2<c.x+c.width-1&&t.y+t.height/2>c.y+1&&t.y+t.height/2<c.y+c.height-1));
    }
   }
   if(original.scenario==='patch-city'){
    const previous=source.runs.find(p=>p.scenario==='line-city'&&p.format===original.format),old=previous.render.hits,now=original.render.hits;
    const changed=now.filter(h=>JSON.stringify(old.find(p=>p.id===h.id))!==JSON.stringify(h));r.changedHitIds=changed.map(h=>h.id);
    r.checks.onlyVendorAMoved=changed.length>0&&changed.every(h=>/(?:vendor[-_]?A|^A(?:$|[-_]))/i.test(h.id));
   }
   r.qualityPass=original.status==='rendered'&&Object.values(r.checks).every(v=>v===true)&&!r.issues.length;
   out.runs.push(r);
  }
 }
}finally{await browser.close();await writeFile(new URL('audit-results.json',dir),JSON.stringify(out,null,2)+'\n');}
console.log(JSON.stringify(out.runs.map(({id,qualityPass,issues,checks})=>({id,qualityPass,issues,failedChecks:Object.entries(checks).filter(([,v])=>v!==true).map(([k])=>k)}))));
