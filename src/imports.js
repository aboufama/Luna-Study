import { MAX_FILE_BYTES, MAX_TOTAL_CHARS, uid } from './study.js';
import { extractPdfText } from './pdf-text.mjs';
import {imageMimeType,readImageMaterial} from './image-imports.mjs';
export async function readMaterial(file, { arrayBuffer,...context } = {}) {
  if(file.size>MAX_FILE_BYTES)throw Error('This file is larger than 20 MB.');
  const type=file.name.split('.').pop().toLowerCase();
  if(imageMimeType(file))return readImageMaterial(file,{arrayBuffer,...context});
  if(!['txt','md','pdf','docx'].includes(type))throw Error('Use PDF, DOCX, TXT, Markdown, PNG, JPEG, or WebP files.');
  let text='',extraction;
  if(type==='txt'||type==='md')text=arrayBuffer?new TextDecoder().decode(arrayBuffer):await file.text();
  else if(type==='docx'){
    const {default:mammoth}=await import('mammoth/mammoth.browser.js');
    try{text=(await mammoth.extractRawText({arrayBuffer:arrayBuffer||await file.arrayBuffer()})).value;}
    catch{throw Error('Could not read this DOCX file. Check that it is a valid Word document.');}
  }else{
    const [pdfjs,{default:workerUrl}]=await Promise.all([import('pdfjs-dist'),import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
    let loading;
    try{
      loading=pdfjs.getDocument({data:new Uint8Array(arrayBuffer||await file.arrayBuffer()),isEvalSupported:false});
      const pdf=await loading.promise;
      ({text,extraction}=await extractPdfText(pdf));
    }catch(error){
      if(error.message?.includes('exceeds'))throw error;
      if(error.name==='PasswordException')throw Error('This PDF is password protected. Upload an unlocked copy.');
      throw Error('Could not read this PDF. Check that the file is valid and unlocked.');
    }finally{await loading?.destroy();}
  }
  text=text.replace(/\u0000/g,'').trim();
  if(!text)throw Error(type==='pdf'?'No readable text found. Scanned PDFs need OCR, which is not available in this prototype.':'No readable text found in this file.');
  if(text.length>MAX_TOTAL_CHARS)throw Error('This file exceeds 500,000 text characters.');
  return {id:uid(),name:file.name,text,type,size:file.size,...(extraction?{extraction}:{})};
}
