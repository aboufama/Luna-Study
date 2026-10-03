import {MAX_FILE_BYTES,MAX_TOTAL_CHARS} from './study.js';
import {fingerprintUpload} from './material-dedup.mjs';

const imageTypes={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
const extensions={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
export const MATERIAL_ACCEPT='.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
export function imageMimeType(file){return imageTypes[file?.type]?file.type:extensions[file?.name?.split('.').pop()?.toLowerCase()]||null;}

export async function readImageMaterial(file,{arrayBuffer,testId,fingerprint,signal,fetchImpl=fetch}={}){
  signal?.throwIfAborted();
  if(file.size>MAX_FILE_BYTES)throw Error('This file is larger than 20 MB.');
  const mime=imageMimeType(file);
  if(!mime)throw Error('Use PNG, JPEG, or WebP images.');
  if(typeof testId!=='string'||!testId)throw Error('Open a test before adding an image.');
  const bytes=arrayBuffer||await file.arrayBuffer();
  if(bytes.byteLength>MAX_FILE_BYTES)throw Error('This file is larger than 20 MB.');
  if(!bytes.byteLength)throw Error('This image is empty.');
  const digest=fingerprint||await fingerprintUpload(bytes);
  signal?.throwIfAborted();
  const requestSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(90000)]);
  const query=new URLSearchParams({testId,name:file.name});
  let response,body;
  try{
    response=await fetchImpl(`/api/material-images?${query}`,{method:'POST',headers:{'Content-Type':mime},body:bytes,signal:requestSignal});
    body=await response.json();
  }catch(error){
    if(requestSignal.aborted){if(signal?.aborted)throw signal.reason||new DOMException('Image import canceled.','AbortError');throw Error('Image reading took too long. Try again.');}
    throw Error('Could not read this image. Check the local server and try again.');
  }
  if(!response.ok)throw Error(typeof body?.error==='string'?body.error:'Image reading is unavailable. Try again when the image service is connected.');
  signal?.throwIfAborted();
  const material=body?.material;
  if(!material||material.id!==`img-${digest}`||material.fingerprint!==digest||!imageTypes[`image/${material.type==='jpg'?'jpeg':material.type}`]||material.size!==bytes.byteLength||typeof material.text!=='string'||!material.text.trim()||material.text.length>MAX_TOTAL_CHARS||material.extraction?.kind!=='vision'||material.extraction?.textOrigin!=='model-derived')throw Error('The image service returned an invalid reading. Try importing the image again.');
  return {...material,name:file.name,originalImage:new Blob([bytes],{type:mime})};
}

// Paste is an explicit user gesture. Never read the clipboard proactively or
// take over a normal paste into a form field or rich-text editor.
export function pastedImageFiles(event,{now=new Date()}={}){
  if(event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return [];
  const clipboard=event.clipboardData;
  if(!clipboard)return [];
  const files=Array.from(clipboard.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
  if(!files.length)files.push(...Array.from(clipboard.files||[]).filter(file=>file.type.startsWith('image/')));
  return files.map((file,index)=>{
    const mime=imageMimeType(file);
    if(!mime||file.name&&/\.(png|jpe?g|webp)$/i.test(file.name)&&file.name!=='image.png')return file;
    const stamp=now.toISOString().replace(/[:.]/g,'-');
    return new File([file],`Screenshot ${stamp}${index?` ${index+1}`:''}.${imageTypes[mime]}`,{type:mime,lastModified:file.lastModified||now.getTime()});
  });
}
