import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, Image as ImageIcon, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-react';
import { pdfExtractionWarning } from './pdf-text.mjs';
import './image-materials.css';

function ImageSourcePreview({source}){
  const [url,setUrl]=useState(null);
  useEffect(()=>{
    if(!(source.originalImage instanceof Blob))return;
    const next=URL.createObjectURL(source.originalImage);setUrl(next);
    return()=>URL.revokeObjectURL(next);
  },[source.originalImage]);
  return <>
    {url?<figure className="source-image"><a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open original image ${source.name} full size`}><img src={url} alt={`Original study image: ${source.name}`}/></a><figcaption>Original image · select to open full size</figcaption></figure>:<p className="quiet-message">The original image is not available in this browser.</p>}
    <h3 className="source-reading-title">Image reading</h3><p className="source-reading-note">AI-extracted text and visual notes. Check the original image for details.</p>
    <pre>{source.text}</pre>
  </>;
}

export default function Library({test,onClose,onAdd,onRemove,onRetry,uploading}) {
  const ref=useRef(null),[query,setQuery]=useState(''),[source,setSource]=useState(null);
  useEffect(()=>{ref.current.showModal();},[]);
  const materials=test.materials.filter(item=>`${item.name} ${item.text}`.toLowerCase().includes(query.toLowerCase()));
  const pending=uploading||test.indexStatus==='indexing';
  return <dialog ref={ref} className="library-drawer" aria-label="Library" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="dialog-heading"><div>{source?<button className="text-button" onClick={()=>setSource(null)}><ArrowLeft size={16}/>Library</button>:<h2 id="library-title">Library</h2>}</div><button className="icon-button" onClick={onClose} aria-label="Close library"><X size={18}/></button></div>
    {source?<article className="source-preview"><h2>{source.name}</h2>{pdfExtractionWarning(source)&&<p className="quiet-message">{pdfExtractionWarning(source)}</p>}{source.extraction?.kind==='vision'?<ImageSourcePreview key={source.id} source={source}/>:<pre>{source.text}</pre>}</article>:<>
      <div className="library-tools"><label className="library-search"><Search size={16}/><input aria-label="Search material" value={query} placeholder="Search material" onChange={e=>setQuery(e.target.value)}/></label><button className="icon-button outlined" onClick={onAdd} disabled={!!uploading} aria-label="Add material"><Plus size={19}/></button></div>
      <div className="library-status" role="status">{pending?<><LoaderCircle size={13} className="spin"/>{uploading||'Indexing in the background'}</>:test.indexStatus==='error'?<><span>Indexing paused</span><button className="text-button" onClick={onRetry}>Retry</button></>:<span>{test.materials.length} {test.materials.length===1?'source':'sources'}{test.materials.length?' · Indexed':''}</span>}</div>
      {test.indexStatus==='error'&&<p className="quiet-error">{test.indexError}</p>}
      <div className="library-list">{materials.map(material=><div className="library-file" key={material.id}>{material.extraction?.kind==='vision'?<ImageIcon size={18}/>:<FileText size={18}/>}<button className="library-file-name" onClick={()=>setSource(material)}><strong>{material.name}</strong><span>{material.type?.toUpperCase()} · {material.extraction?.kind==='vision'?'Image reading':`${material.text.trim().split(/\s+/).length.toLocaleString()} words`}</span>{material.extraction?.pagesWithoutText?.length>0&&<span>{pdfExtractionWarning(material)}</span>}</button><button className="icon-button" aria-label={`Remove ${material.name}`} onClick={()=>onRemove(material.id)} disabled={!!uploading}><Trash2 size={15}/></button></div>)}</div>
      {!test.materials.length&&<button className="library-empty" onClick={onAdd}><Plus size={24}/><span>Add your notes, readings, slides, or screenshots</span><small>PDF, DOCX, TXT, MD, PNG, JPEG, WebP</small><small>Or paste an image into your study session</small></button>}
      {!!test.materials.length&&<p className="library-image-hint">You can also drop or paste a screenshot into your study session.</p>}
      {!!test.materials.length&&!materials.length&&<p className="quiet-message">No matching material.</p>}
      {test.guide?.topics?.length>0&&<div className="library-topics"><h3>In your material</h3>{test.guide.topics.map((topic,index)=><details key={index}><summary>{topic.title}</summary><p>{topic.summary}</p></details>)}</div>}
    </>}
  </dialog>;
}
