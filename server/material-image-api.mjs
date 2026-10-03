import { CodexError } from './codex.mjs';
import { IMAGE_BYTES_LIMIT } from './material-images.mjs';

const fail=(status,message)=>{throw new CodexError(status,message);};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};

export function createMaterialImageHandler({ importer }={}) {
  return async function handleMaterialImage(req,res){
    const url=new URL(req.url,'http://localhost');
    if(url.pathname!=='/api/material-images')return false;
    const controller=new AbortController();
    const abort=()=>{if(!res.writableEnded)controller.abort();};
    req.on('aborted',abort);res.on('close',abort);
    try{
      if(req.method!=='POST')fail(405,'Use POST to import a screenshot.');
      const host=req.headers.host;
      if(![`127.0.0.1:${req.socket.localPort}`,`localhost:${req.socket.localPort}`].includes(host)||req.headers.origin!==`http://${host}`||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))fail(403,'Import screenshots from the local Luna app.');
      const mimeType=(req.headers['content-type']||'').toLowerCase();
      if(!['image/png','image/jpeg','image/webp'].includes(mimeType))fail(415,'Upload a PNG, JPEG or WebP screenshot.');
      if(Number(req.headers['content-length'])>IMAGE_BYTES_LIMIT)fail(413,'Each screenshot must be no larger than 20 MB.');
      const parts=[];let size=0;
      for await(const part of req){size+=part.length;if(size>IMAGE_BYTES_LIMIT)fail(413,'Each screenshot must be no larger than 20 MB.');parts.push(part);}
      if(!importer)fail(503,'Screenshot reading needs the live OpenAI API. Configure it on the Luna server first.');
      const material=await importer.import({testId:url.searchParams.get('testId'),name:url.searchParams.get('name'),bytes:Buffer.concat(parts),mimeType,signal:controller.signal});
      if(!controller.signal.aborted)json(res,200,{material});
    }catch(error){if(!res.destroyed&&!res.headersSent)json(res,error instanceof CodexError?error.status:500,{error:error instanceof CodexError?error.message:'The screenshot could not be imported. Please try again.'});}
    finally{req.off('aborted',abort);res.off('close',abort);}
    return true;
  };
}
