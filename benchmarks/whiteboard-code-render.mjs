// Benchmark-only generated code runs solely in an opaque, script-only iframe.
// CSP + browser interception deny network. It receives no credentials or app data.
import { readFile } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
export const codePrompts={
 canvas:'Return exactly one JavaScript function draw(ctx, hit). ctx is the native CanvasRenderingContext2D of an 800 by 500 canvas; hit(id,x,y,width,height) registers a stable selectable rectangle. Use normal Canvas 2D drawing calls, loops, helper functions and Math as useful. Use hit for each semantic object and every table cell (cell-r0-c0 etc). Draw on white, readable 16px+ Arial labels. All facts, positions, dimensions and identity must be visible/accurate. Entire scene is drawn each invocation; for updates preserve IDs and unaffected geometry. No imports, external libraries, DOM, events, timers, promises, images, network, eval or dynamic code. No markdown fences. The function will run in an isolated browser. Return a complete function, not an invocation.',
 react:'Return exactly one React JSX function Board(). React is provided; no imports or exports. It renders into an 800 by 500 white stage. Use declarative HTML/CSS, inline styles, SVG JSX, arrays/map, helpers and Math where useful. Give every semantic object a stable data-id; every table cell must have its own stable data-id (cell-r0-c0 etc). Preserve IDs and unaffected geometry on edits. All labels 16px+ and readable. Do not use effects, events, state, timers, promises, DOM/global access, dangerouslySetInnerHTML, network, canvas, foreignObject, external libraries/assets, eval or dynamic code. No markdown fences. Return a complete component function, not an invocation.'
};
export async function compileCode(format,raw){
 if(!['canvas','react'].includes(format)||typeof raw!=='string'||raw.length>50000||!raw.trim())throw Error('Invalid generated code.');
 if(/\b(?:fetch|XMLHttpRequest|WebSocket|import|export|eval|Function|document|window|globalThis|location|navigator|localStorage|sessionStorage|indexedDB|Worker|setTimeout|setInterval|requestAnimationFrame|Image|Audio|WebAssembly)\b|\b(?:top|parent|self)\s*[.\[]|dangerouslySetInnerHTML|foreignObject|\bon[A-Z]\w*\s*=|\bwhile\s*\(|\bdo\s*\{|for\s*\(\s*;/u.test(raw))throw Error('Code outside bounded benchmark contract.');
 const expected=format==='canvas'?'draw':'Board';
 if(!new RegExp(`^\\s*function\\s+${expected}\\s*\\(`).test(raw))throw Error('Expected a named drawing function.');
 const compiled=await transformWithOxc(raw,'board.jsx',{jsx:{runtime:'classic'}});
 if(compiled.warnings?.length)throw Error('Compiler warnings: review code.');
 return compiled.code;
}
const literal=value=>JSON.stringify(value).replaceAll('<','\\u003c');
export async function codeDocument(format,compiled){
 const runtime=format==='react'?await readFile(new URL('./whiteboard-code/vendor/react-runtime.js',import.meta.url),'utf8'):'';
 const bootstrap=`window.__done=false;window.__error=null;window.__texts=[];window.__hits=[];window.__draws=[];window.addEventListener('error',e=>window.__error=String(e.message).slice(0,180));`;
 const canvas=`const canvas=document.querySelector('canvas'),native=canvas.getContext('2d');let count=0;
 native.fillStyle='white';native.fillRect(0,0,800,500);native.fillStyle='#243544';native.strokeStyle='#243544';native.lineWidth=2;native.font='18px Arial';
 const ctx=new Proxy(native,{get(target,key){const v=target[key];if(typeof v!=='function')return v;return(...args)=>{if(++count>12000)throw Error('Drawing call limit');if(key==='fillText'||key==='strokeText'){const [text,x,y]=args,m=target.measureText(String(text)),fontSize=Number(target.font.match(/([0-9.]+)px/)?.[1]),transform=target.getTransform(),points=[[x-m.actualBoundingBoxLeft,y-m.actualBoundingBoxAscent],[x+m.actualBoundingBoxRight,y-m.actualBoundingBoxAscent],[x-m.actualBoundingBoxLeft,y+m.actualBoundingBoxDescent],[x+m.actualBoundingBoxRight,y+m.actualBoundingBoxDescent]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(transform)),left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),right=Math.max(...points.map(p=>p.x)),bottom=Math.max(...points.map(p=>p.y));window.__texts.push({text:String(text),color:key==='fillText'?target.fillStyle:target.strokeStyle,alpha:target.globalAlpha,x:left,y:top,width:right-left,height:bottom-top,fontSize:fontSize*Math.hypot(transform.a,transform.b)});}if(window.__draws.length<3000)window.__draws.push({op:key,args:args.map(v=>typeof v==='number'||typeof v==='string'?v:null)});return v.apply(target,args);};},set(target,key,value){target[key]=value;return true;}});
 const hit=(id,x,y,width,height)=>{if(typeof id!=='string'||id.length>120||![x,y,width,height].every(Number.isFinite)||width<0||height<0||window.__hits.length>=2000)throw Error('Invalid hit region');window.__hits.push({id,x,y,width,height});};
 draw(ctx,hit);window.__done=true;`;
 const react=`renderBoard(Board);requestAnimationFrame(()=>requestAnimationFrame(()=>window.__done=true));`;
 const code=bootstrap+'\n'+runtime+'\n'+compiled+'\ntry{'+(format==='canvas'?canvas:react)+'}catch(error){window.__error=String(error.message).slice(0,180);window.__done=true;}';
 return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src \'none\'; connect-src \'none\'; font-src \'none\'; form-action \'none\'; base-uri \'none\'"><style>*{box-sizing:border-box}html,body{margin:0;width:800px;height:500px;overflow:hidden;font-family:Arial,sans-serif;background:white}#stage{position:relative;width:800px;height:500px}svg{overflow:visible}</style></head><body><main id="stage">'+(format==='canvas'?'<canvas width="800" height="500"></canvas>':'')+'</main><script>'+code.replaceAll('</script','<\\/script')+'</script></body></html>';
}
export async function renderCode(browser,format,raw,{screenshot}={}){
 const start=performance.now(),compiled=await compileCode(format,raw),compilationMs=performance.now()-start;
 const context=await browser.newContext({viewport:{width:840,height:540}}),blocked=[];
 await context.route('**/*',route=>{blocked.push(route.request().url());return route.abort();});
 const page=await context.newPage();let timeout;
 try{
  const task=(async()=>{
   await page.setContent('<!doctype html><body style="margin:0"><iframe id="preview" sandbox="allow-scripts" style="border:0;width:800px;height:500px"></iframe></body>');
   const html=await codeDocument(format,compiled);
   await page.locator('#preview').evaluate((frame,html)=>{frame.srcdoc=html;},html);
   await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow!=null);
   const frame=page.frames().find(f=>f!==page.mainFrame());
   await frame.waitForFunction(()=>window.__done||window.__error,{},{timeout:2000});
   const result=await frame.evaluate(async format=>{
    if(window.__error)throw Error(window.__error);await document.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    const stage=document.querySelector('#stage'),base=stage.getBoundingClientRect();
    let texts=window.__texts,hits=window.__hits;
    if(format==='react'){
     const walker=document.createTreeWalker(stage,NodeFilter.SHOW_TEXT),out=[];let node;
     while(node=walker.nextNode()){const text=node.textContent.trim();if(!text)continue;const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect(),style=getComputedStyle(node.parentElement);out.push({text,id:node.parentElement.closest('[data-id],[id]')?.getAttribute('data-id')||node.parentElement.closest('[id]')?.id,x:r.x-base.x,y:r.y-base.y,width:r.width,height:r.height,fontSize:parseFloat(style.fontSize)});}texts=out;
     hits=[...stage.querySelectorAll('[data-id],[id]')].map(el=>{const r=el.getBoundingClientRect();return{id:el.getAttribute('data-id')||el.id,tag:el.tagName,x:r.x-base.x,y:r.y-base.y,width:r.width,height:r.height};});
    }
    const ids=hits.map(h=>h.id);const cells=hits.filter(h=>/cell[-_]?r?\d+[-_]?c\d+/i.test(h.id));
    return {texts,hits,cells,ids,duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i),clippedLabels:texts.filter(t=>t.x<-.5||t.y<-.5||t.x+t.width>800.5||t.y+t.height>500.5),smallLabels:texts.filter(t=>t.fontSize<11),draws:window.__draws,hasSvg:Boolean(stage.querySelector('svg')),hasHtmlTable:Boolean(stage.querySelector('table')),hasCanvas:Boolean(stage.querySelector('canvas')),domElements:stage.querySelectorAll('*').length};
   },format);
   const renderReadyAt=performance.now();
   if(screenshot)await page.locator('#preview').screenshot({path:screenshot});
   return {html,compiled,compilationMs,renderReadyAt,render:result,blockedRequests:blocked};
  })();
  return await Promise.race([task,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Isolated render deadline exceeded.')),3500);})]);
 }finally{clearTimeout(timeout);await context.close();}
}
