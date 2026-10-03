// Actual native libraries, isolated benchmark dependencies. No production imports.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

export const versions = { excalidraw: '0.18.1', vega: '6.4.0', vegaLite: '6.4.3', esbuild: '0.25.10' };
export const deps = process.env.LUNA_NATIVE_BENCH_DEPS || '/tmp/luna-native-board-deps';
export const prompts = {
  excalidraw: `Return only an Excalidraw scene JSON: {"type":"excalidraw","version":2,"source":"benchmark","elements":[...],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}. Use native elements rectangle, ellipse, line, arrow, text only. Every element requires stable id, type, x, y, width, height, and roughness:0. Coordinates are actual pixels in a fixed 800x500 world, with generous margins. All text elements additionally require text, fontFamily:2 (Helvetica), fontSize at least16, lineHeight:1.25, textAlign:"left"|"center", verticalAlign:"top"; provide sufficient positive width/height so text is not dropped by native import. Lines/arrows require points:[[0,0],[dx,dy],...] in local coordinates; use endArrowhead:"arrow" for directed arrows. Use strokeColor:"#243544", backgroundColor:"#ffffff" for boxes/cells, fillStyle:"solid", strokeWidth:1 or2. Native restore fills omitted administrative fields. Text is a separate element. A matrix must have one rectangle per cell with id matrix-cell-ROW-COL, zero-based, plus separate value text and axis labels. Use stable IDs for nodes, arrows, vendors and labels. No images, links, frames, embedded content, deleted elements, decorative backgrounds, or external resources. The native SVG exporter preserves the authored geometry; it does not lay out graphs or matrices for you. An edit returns a full scene preserving every unchanged element's id and coordinates.`,
  vega: `Return only a Vega-Lite v6 JSON specification with inline data.values, no URLs or external datasets. Use width:680 and height:380, white background, dark labels at least14px including axis/legend labels, explicit axis/domain/sort settings. This is an actual Vega-Lite compiler and Vega SVG renderer. Supported tasks here are connected sampled function plots and general multiseries data charts. For the function use mark line with point:true, numeric x/y fields, domain [-2,2] and [0,4], and the exact five supplied points; data must include stable id values. For a general chart use the supplied data exactly, correct units, separate identifiable series and a readable legend; do not fabricate observations. Include stable datum ids and tooltip id fields for native hit testing. Layered marks are allowed. No params, selection expressions, transforms, calculate/filter, signals, condition/test expressions, hyperlinks, HTML, images, or user-written expressions. Let the native renderer perform chart layout. Return no Markdown fences or explanation.`,
};

export function validateNative(format, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid-json-envelope');
  if (format === 'excalidraw') {
    if (value.type !== 'excalidraw' || value.version !== 2 || !Array.isArray(value.elements) || !value.elements.length || value.elements.length > 180 || Object.keys(value.files || {}).length) throw Error('invalid-excalidraw-envelope');
    const ids = new Set();
    for (const el of value.elements) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(el.id || '') || ids.has(el.id) || !['rectangle','ellipse','line','arrow','text'].includes(el.type) || el.isDeleted || el.link || !['x','y','width','height'].every(key => Number.isFinite(el[key]) && Math.abs(el[key]) <= 2000)) throw Error('invalid-excalidraw-element');
      ids.add(el.id);
      if (['rectangle','ellipse','text'].includes(el.type) && !(el.width > 0 && el.height > 0)) throw Error('empty-excalidraw-element');
      if (el.type === 'text' && (typeof el.text !== 'string' || el.text.length > 600 || el.fontFamily !== 2 || !(el.fontSize >= 12 && el.fontSize <= 60))) throw Error('invalid-native-text');
      if (['line','arrow'].includes(el.type) && (!Array.isArray(el.points) || el.points.length < 2 || el.points.length > 256 || el.points.some(point => !Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isFinite(n) || Math.abs(n) > 2000)))) throw Error('invalid-native-line');
    }
  } else {
    if (!Array.isArray(value.data?.values) || value.data.values.length > 100 || !value.data.values.length) throw Error('vega-needs-inline-data');
    const forbidden = new Set(['url','href','expr','signal','signals','calculate','filter','transform','params','condition','test','datasets']);
    function walk(node) { if (node && typeof node === 'object') for (const [key, child] of Object.entries(node)) { if (forbidden.has(key)) throw Error('vega-outside-static-contract'); walk(child); } }
    walk(value);
    if (!(value.mark || Array.isArray(value.layer))) throw Error('vega-needs-mark');
  }
  return value;
}

export async function createNativeRenderer(out) {
  const { build } = await import(pathToFileURL(`${deps}/node_modules/esbuild/lib/main.js`));
  const entry = `${deps}/entry.js`, bundle = `${deps}/bundle.js`;
  await writeFile(entry, `import {restoreElements,exportToSvg,getCommonBounds} from '@excalidraw/excalidraw';import * as vega from 'vega';import {compile} from 'vega-lite';window.NativeBoard={restoreElements,exportToSvg,getCommonBounds,vega,compile};`);
  await build({ entryPoints:[entry], outfile:bundle, bundle:true, format:'iife', platform:'browser', define:{'process.env.NODE_ENV':'"production"'}, loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.css':'empty'}, logLevel:'silent' });
  await mkdir(out, { recursive:true });
  await copyFile(`${deps}/package-lock.json`, new URL('dependency-lock.json',out));
  const browser = await chromium.launch({headless:true}), page = await browser.newPage({viewport:{width:800,height:500}}), blocked = [];
  await page.route('**/*',route=>{blocked.push(route.request().url());route.abort();});
  await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:white}#surface{width:800px;height:500px;overflow:hidden}#surface>svg{display:block}</style><div id="surface"></div>');
  const loadStart = performance.now(); await page.addScriptTag({path:bundle});
  const initializationMs = performance.now() - loadStart;
  return { initializationMs, blocked, async close(){await browser.close();}, async inspect(format,rendered,screenshotPath) {
    if(format==='vega') {
      rendered.clickProbes=[];
      for(const mark of rendered.marks.filter(mark=>mark.label?.includes('id:')&&mark.width>0&&mark.height>0&&mark.width<25&&mark.height<25).slice(0,16)) {
        await page.mouse.click(mark.x+mark.width/2,mark.y+mark.height/2);
        const expectedId=mark.label.match(/(?:^|;\s*)id:\s*([^;]+)/)?.[1]?.trim()||null;
        rendered.clickProbes.push({label:mark.label,expectedId,selectedId:await page.evaluate(()=>window.nativeSelection)});
      }
    }
    if(screenshotPath)await page.screenshot({path:screenshotPath});
  }, async render(format, scene) {
    validateNative(format,scene);
    const rendered = await page.evaluate(async ({format,scene}) => {
      const native = window.NativeBoard, root = document.querySelector('#surface'); root.replaceChildren(); window.nativeSelection = null;
      let elements = null, bounds = null, nativeMarkup, warnings = [], view = null;
      const began = performance.now();
      if (format === 'excalidraw') {
        elements = native.restoreElements(scene.elements,null,{refreshDimensions:true,repairBindings:true});
        if (elements.length !== scene.elements.length || elements.some((el,i)=>el.id!==scene.elements[i].id)) throw Error('native-restore-changed-element-identity');
        bounds = native.getCommonBounds(elements);
        const svg = await native.exportToSvg({elements,files:{},exportPadding:0,skipInliningFonts:true,appState:{exportBackground:false,viewBackgroundColor:'#fff',exportEmbedScene:false}});
        nativeMarkup = svg.outerHTML;
        const frame = document.createElementNS('http://www.w3.org/2000/svg','svg');frame.setAttribute('width','800');frame.setAttribute('height','500');frame.setAttribute('viewBox','0 0 800 500');
        svg.setAttribute('x',String(bounds[0]));svg.setAttribute('y',String(bounds[1]));frame.append(svg);root.append(frame);
      } else {
        const logger={level(){return this},warn(...args){warnings.push(args.map(String).join(' '))},info(){},debug(){},error(...args){warnings.push(args.map(String).join(' '))}};
        const compiled = native.compile(scene,{logger}).spec;
        view = new native.vega.View(native.vega.parse(compiled),{renderer:'svg',hover:false}).initialize(root);
        view.addEventListener('click',(_,item)=>{window.nativeSelection=item?.datum?.id??null;});
        await view.runAsync(); nativeMarkup=await view.toSVG();
        const svg=root.querySelector('svg');svg.setAttribute('width','800');svg.setAttribute('height','500');
      }
      const nativeRenderMs=performance.now()-began;
      await document.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      const svg=root.querySelector('svg'),box=svg.getBoundingClientRect(),texts=[...svg.querySelectorAll('text')].map(el=>{const b=el.getBoundingClientRect();return{text:el.textContent.trim(),x:b.x-box.x,y:b.y-box.y,width:b.width,height:b.height,fontSize:parseFloat(getComputedStyle(el).fontSize)};}).filter(t=>t.text);
      const overlap=[];for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){const a=texts[i],b=texts[j],w=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),h=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);if(w>2&&h>2&&w*h>Math.min(a.width*a.height,b.width*b.height)*.12)overlap.push([a.text,b.text]);}
      const cells=elements?.filter(el=>el.type==='rectangle'&&/-cell-\d+-\d+$/.test(el.id))||[];
      const domIds=[...svg.querySelectorAll('[id]')].map(el=>el.id);
      const marks=[...svg.querySelectorAll('[role="graphics-symbol"]')].map(el=>{const b=el.getBoundingClientRect();return {tag:el.tagName,label:el.getAttribute('aria-label'),x:b.x,y:b.y,width:b.width,height:b.height};});
      // Native scene IDs are not invented onto Excalidraw's exported SVG.
      return {svg:svg.outerHTML,nativeSvg:nativeMarkup,elements,bounds,texts,cells,domIds,marks,warnings,nativeRenderMs,overlap,clipped:texts.filter(t=>t.x<-.5||t.y<-.5||t.x+t.width>800.5||t.y+t.height>500.5),smallLabels:texts.filter(t=>t.fontSize<11),externalContent:svg.querySelectorAll('script,foreignObject,image,a').length,selectionScope:format==='excalidraw'?'Native scene IDs retained; SVG export has no semantic DOM mapping. Full editor hit testing is not measured.':'Native Vega scenegraph datum identity; click probes below inspect rendered marks.'};
    },{format,scene});
    return rendered;
  }};
}
