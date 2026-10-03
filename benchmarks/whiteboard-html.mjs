// Benchmark-only static HTML/CSS contract. No generated code is executed.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import postcss from 'postcss';

export const htmlFormatPrompt = `Return only one static HTML fragment: <div id="board" data-board-root="true" style="position:relative;width:800px;height:500px">...</div>. Use explicit closing tags and quoted attributes: this is an XML-well-formed HTML subset; <br/> is allowed. Canvas coordinates are 800 by 500 pixels. HTML/CSS performs layout; do not embed SVG, canvas, scripts, images, links, forms, iframes, external fonts or resources. Allowed tags: div, span, p, table, thead, tbody, tfoot, tr, th, td, caption, colgroup, col, section, h1, h2, h3, br, hr, b, strong, em, u, mark, small, sup, sub, style. Optional style blocks use only simple tag, #id, .class selectors with descendant/child/comma combinations. Inline styles are allowed. No @rules, pseudo selectors, attribute selectors, comments, custom properties, URL, var, calc, expression, animation, fixed/sticky positioning or generated content. Use ordinary dark colors; numeric px/%/em/rem/fr dimensions; CSS grid/flex/table, borders, margins/padding, absolute/relative positioning, text alignment, and translate/rotate/scale transforms are supported. Give each semantic node, vendor, connector, and matrix cell a stable id. Use matrix-cell-r-c for zero-based row/column cell IDs, on the full td/div cell area, not just its text. Use id-bearing div borders and rotations for diagram lines; use table/grid for matrices. Include all required facts and labels, preserve unspecified blanks. For edits, return the complete scene with existing IDs, layout, and unchanged objects preserved. No arbitrary JS or patch scripts. All text must fit inside the 800×500 root with readable font sizes. Avoid redundant text labels when already present.`;

const TAGS = new Set('div span p table thead tbody tfoot tr th td caption colgroup col section h1 h2 h3 br hr b strong em u mark small sup sub style'.split(' '));
const IDS = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const LENGTH = /^(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|em|rem|fr|deg)?|auto|min-content|max-content|fit-content)$/;
const COLOR = /^(?:#[\da-f]{3,8}|black|white|gray|grey|silver|navy|blue|red|green|teal|purple|orange|yellow|transparent|currentcolor|rgb\(\s*[\d.%]+\s*,\s*[\d.%]+\s*,\s*[\d.%]+\s*\)|rgba\(\s*[\d.%]+\s*,\s*[\d.%]+\s*,\s*[\d.%]+\s*,\s*[\d.]+\s*\))$/i;
const DIMENSIONS = new Set('width height min-width max-width min-height max-height top left right bottom margin margin-top margin-left margin-right margin-bottom padding padding-top padding-left padding-right padding-bottom gap row-gap column-gap border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius border-width border-top-width border-right-width border-bottom-width border-left-width font-size line-height letter-spacing word-spacing flex-basis'.split(' '));
const ENUMS = {
  position:['relative','absolute','static'], display:['block','inline','inline-block','flex','inline-flex','grid','inline-grid','table','table-row','table-cell','table-header-group','table-row-group','table-column','table-column-group','table-caption'],
  'box-sizing':['border-box','content-box'], overflow:['hidden','visible','clip'], 'overflow-x':['hidden','visible','clip'], 'overflow-y':['hidden','visible','clip'],
  'text-align':['left','right','center','justify','start','end'], 'vertical-align':['top','middle','bottom','baseline','sub','super'],'caption-side':['top','bottom'], 'white-space':['normal','nowrap','pre','pre-wrap','pre-line'],
  'font-style':['normal','italic'], 'font-weight':['normal','bold','400','500','600','700','800'], 'text-decoration':['none','underline'],
  'border-style':['none','solid','dashed','dotted','double'], 'border-top-style':['none','solid','dashed','dotted'], 'border-right-style':['none','solid','dashed','dotted'], 'border-bottom-style':['none','solid','dashed','dotted'], 'border-left-style':['none','solid','dashed','dotted'],
  'border-collapse':['collapse','separate'], 'table-layout':['fixed','auto'], 'empty-cells':['show'], 'flex-direction':['row','column','row-reverse','column-reverse'], 'flex-wrap':['nowrap','wrap'],
  'justify-content':['start','end','flex-start','flex-end','center','space-between','space-around','space-evenly'], 'align-items':['start','end','flex-start','flex-end','center','stretch','baseline'], 'align-content':['start','end','center','stretch','space-between','space-around'],
  'justify-items':['start','end','center','stretch'], 'align-self':['auto','start','end','center','stretch'], 'justify-self':['auto','start','end','center','stretch'], 'grid-auto-flow':['row','column'],
};
function validNumbers(value) { return [...value.matchAll(/-?(?:\d+(?:\.\d+)?|\.\d+)/g)].every(m => Number.isFinite(+m[0]) && Math.abs(+m[0]) <= 4000); }
function validDeclaration(node) {
  if (node.type !== 'decl' || node.important || node.prop.startsWith('--')) return false;
  const key=node.prop.toLowerCase(), value=node.value.trim();
  if (!value || value.length>300 || /[\\{};<>@!]|url|expression|javascript|(?:^|[^a-z])(?:var|env|attr|calc)\s*\(/i.test(value)) return false;
  if (!validNumbers(value.replace(/#[\da-f]{3,8}/gi,''))) return false;
  if (ENUMS[key]) return ENUMS[key].includes(value.toLowerCase());
  if (DIMENSIONS.has(key) || key==='border-spacing') return value.split(/\s+/).length<=4 && value.split(/\s+/).every(x=>LENGTH.test(x));
  if (key==='color'||key==='background-color'||key==='background'||/^border(?:-(?:top|left|right|bottom))?-color$/.test(key)) return COLOR.test(value);
  if (/^border(?:-(?:top|left|right|bottom))?$/.test(key)) return /^(?:0|none)$/.test(value) || /^(?:\d+(?:\.\d+)?px)\s+(?:solid|dashed|dotted|double)\s+/.test(value) && COLOR.test(value.replace(/^(?:\d+(?:\.\d+)?px)\s+(?:solid|dashed|dotted|double)\s+/,''));
  if (key==='font-family') return /^[A-Za-z\s,'"-]+$/.test(value) && value.length<=100;
  if (key==='z-index'||key==='order') return /^\d{1,2}$/.test(value);
  if (key==='flex-grow'||key==='flex-shrink') return /^\d(?:\.\d+)?$/.test(value);
  if (key==='flex') return /^(?:none|auto|\d(?:\.\d+)?(?:\s+\d(?:\.\d+)?)?(?:\s+(?:0|\d+(?:\.\d+)?(?:px|%)))?)$/.test(value);
  if (key==='grid-template-columns'||key==='grid-template-rows'||key==='grid-auto-columns'||key==='grid-auto-rows') {
    if (!/^[\d.\s%,()a-z-]+$/i.test(value)) return false;
    const stripped=value.replace(/repeat\(\s*([1-9]|[1-9]\d|100)\s*,\s*((?:\d+(?:\.\d+)?)(?:px|%|em|rem|fr)|auto)\s*\)/g,'1fr');
    return stripped.split(/\s+/).every(x=>LENGTH.test(x));
  }
  if (key==='grid-column'||key==='grid-row') return /^(?:auto|(?:span\s+)?[1-9]\d?(?:\s*\/\s*(?:span\s+)?[1-9]\d?)?)$/.test(value);
  if (key==='transform-origin') return value.split(/\s+/).length<=2 && value.split(/\s+/).every(x=>LENGTH.test(x)||['left','right','top','bottom','center'].includes(x));
  if (key==='transform') return /^(?:(?:translate(?:X|Y)?|rotate|scale(?:X|Y)?)\(\s*-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|deg)?(?:\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%)?)?\s*\)\s*)+$/.test(value) || value==='none';
  return false;
}
function selectorAllowed(selector) {
  if (selector.length>240 || /[\[\]:+~\\*|]/.test(selector)) return false;
  return selector.split(',').every(part=>part.trim().split(/\s*>\s*|\s+/).every(token=>/^(?:[a-z][a-z0-9-]*)?(?:[.#][A-Za-z][A-Za-z0-9_-]*)*$/.test(token) && token.length>0 && (!/^[a-z]/.test(token)||TAGS.has(token.match(/^[a-z][a-z0-9-]*/)[0]))));
}
function safeCss(css, inline=false) {
  if (css.length>25000 || /[\\<]/.test(css)) throw Error('Unsupported CSS syntax.');
  const ast=postcss.parse(css,{from:undefined});
  if ((ast.nodes||[]).length>200) throw Error('Too many CSS rules.');
  for (const node of ast.nodes||[]) {
    if (inline) { if (!validDeclaration(node)) throw Error('Unsupported CSS declaration.'); }
    else { if (node.type!=='rule'||!selectorAllowed(node.selector)||(node.nodes||[]).length>80||!node.nodes.every(validDeclaration)) throw Error('Unsupported CSS rule.'); }
  }
  return ast.toString();
}
function textsOf(node) { return node.textContent.replace(/\s+/g,' ').trim(); }
export function parseHtmlFormat(text,{previous}={}) {
  try {
    if (typeof text!=='string'||text.length>100000||/<!|<\?|\u0000/.test(text)) throw Error('Unsupported HTML input.');
    let bad=false;
    const doc=new DOMParser({errorHandler:{warning(){bad=true;},error(){bad=true;},fatalError(){bad=true;}}}).parseFromString(text.trim(),'application/xml');
    const root=doc.documentElement;
    if (bad||!root||root.tagName!=='div'||root.getAttribute('data-board-root')!=='true'||root.getAttribute('id')!=='board') throw Error('Expected one well-formed board div.');
    for (const node of Array.from(doc.childNodes)) if (node!==root && (node.nodeType!==3||node.textContent.trim())) throw Error('Expected one root.');
    const elements=[root,...Array.from(root.getElementsByTagName('*'))];
    if (elements.length>1200) throw Error('Too many HTML elements.');
    const ids=[],textRows=[],cells=[];
    for(const el of elements) {
      if (!TAGS.has(el.tagName)||el.namespaceURI) throw Error('Unsupported HTML element.');
      for(const child of Array.from(el.childNodes)) if (![1,3].includes(child.nodeType)) throw Error('Unsupported HTML node.');
      for(const attr of Array.from(el.attributes)) {
        const key=attr.name,value=attr.value;
        if (key==='id') { if (!IDS.test(value)||ids.includes(value)) throw Error('Invalid or duplicate object ID.'); ids.push(value); }
        else if(key==='class') { if(value.length>240||!value.split(/\s+/).every(x=>IDS.test(x))) throw Error('Invalid class.'); }
        else if(key==='style') el.setAttribute('style',safeCss(value,true));
        else if(key==='data-board-root') { if(el!==root||value!=='true') throw Error('Invalid board root.'); }
        else if(['data-selectable','data-id','data-board-zone'].includes(key)) { if(!IDS.test(value)||value!==el.getAttribute('id')) throw Error('Selection identity must match element ID.'); }
        else if(['colspan','rowspan'].includes(key)&&['td','th'].includes(el.tagName)) { if(!/^(?:[1-9]|1[0-2])$/.test(value)) throw Error('Invalid table span.'); }
        else if(key==='span'&&['col','colgroup'].includes(el.tagName)){if(!/^(?:[1-9]|1[0-2])$/.test(value))throw Error('Invalid column span.');}
        else if(key==='scope'&&el.tagName==='th') { if(!['row','col'].includes(value)) throw Error('Invalid table scope.'); }
        else if(key==='aria-label'||key==='role') { if(value.length>160||/[<>]/.test(value)) throw Error('Invalid accessible label.'); }
        else throw Error('Unsupported HTML attribute.');
      }
      if(el.tagName==='style') {
        if(el.attributes.length||Array.from(el.childNodes).some(x=>x.nodeType!==3)) throw Error('Unsupported style element.');
        el.textContent=safeCss(el.textContent);
      } else {
        if(!Array.from(el.childNodes).some(x=>x.nodeType===1)&&textsOf(el)) textRows.push(textsOf(el));
        const match=el.getAttribute('id')?.match(/^(.+-cell)-(\d+)-(\d+)$/);
        if(match&&['td','th','div'].includes(el.tagName)) cells.push({prefix:match[1],id:el.getAttribute('id'),row:+match[2],col:+match[3],value:textsOf(el)});
      }
    }
    // Fixed frame is part of the comparison contract, independent of generated CSS.
    const rootCss=postcss.parse(root.getAttribute('style')||'',{from:undefined});
    const rootDecls=new Map(rootCss.nodes.map(x=>[x.prop.toLowerCase(),x.value.toLowerCase()]));
    if(rootDecls.get('width')!=='800px'||rootDecls.get('height')!=='500px'||rootDecls.get('position')!=='relative') throw Error('Board frame must be relative 800px by 500px.');
    const matrices=[];
    for(const prefix of new Set(cells.map(c=>c.prefix))) {
      const group=cells.filter(c=>c.prefix===prefix),rows=Math.max(...group.map(c=>c.row))+1,cols=Math.max(...group.map(c=>c.col))+1;
      if(rows>12||cols>12) throw Error('Matrix dimensions exceed comparison limits.');
      const values=Array.from({length:rows},()=>Array(cols).fill(''));for(const cell of group)values[cell.row][cell.col]=cell.value;
      matrices.push({id:prefix.replace(/-cell$/,''),rows,cols,values,indexedCells:group.length,completeGrid:group.length===rows*cols});
    }
    const styleTexts=elements.filter(el=>el.tagName==='style').map(el=>el.textContent);
    const html=new XMLSerializer().serializeToString(root).replace(/<style>[\s\S]*?<\/style>/g,()=>'<style>'+styleTexts.shift()+'</style>').replace(/<(div|span|p|table|thead|tbody|tfoot|tr|th|td|caption|colgroup|section|h1|h2|h3|b|strong|em|u|mark|small|sup|sub|style)(\s[^<>]*?)?\/>/g,'<$1$2></$1>'),prior=previous?.scene||previous,priorIds=prior?.ids||[];
    const stats={ids,texts:textRows,selectableIds:[...ids],authoredIds:[...ids],derivedIds:[],cellIds:cells.map(c=>c.id),matrices,elements:elements.length,retainedIds:priorIds.filter(id=>ids.includes(id)),removedIds:priorIds.filter(id=>!ids.includes(id)),htmlBytes:Buffer.byteLength(html)};
    return {valid:true,html,scene:{format:'html',html,ids},errors:[],stats};
  } catch(error) { return {valid:false,html:null,scene:null,errors:[String(error.message||'Invalid HTML fragment.').slice(0,180)],stats:{}}; }
}
export function htmlDocument(parsed) {
  if(!parsed?.valid||typeof parsed.html!=='string') throw Error('Validated HTML required.');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;padding:0;width:800px;height:500px;overflow:hidden;background:white;color:#172c3f;font:16px Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}#board{width:800px!important;height:500px!important;position:relative!important;overflow:hidden!important}</style></head><body>${parsed.html}</body></html>`;
}
