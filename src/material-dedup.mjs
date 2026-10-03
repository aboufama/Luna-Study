const normalizeText=value=>String(value||'').replace(/\r\n?/g,'\n').replace(/\u0000/g,'').trim();
const plainText=material=>['txt','md'].includes(material.type||material.name?.split('.').pop()?.toLowerCase());

export async function fingerprintUpload(bytes) {
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export function duplicateMaterial(candidate,materials) {
  return materials.find(material=>{
    if(candidate.fingerprint&&candidate.fingerprint===material.fingerprint)return true;
    // Earlier saved imports have no original bytes to hash. Preserve the
    // existing same-file check until the source is replaced with a hashed copy.
    if(!material.fingerprint&&candidate.name===material.name&&candidate.size===material.size
      &&typeof candidate.text==='string'&&candidate.text===material.text)return true;
    // Plain-text notes may differ only in line endings or a renamed extension.
    // Different PDFs/DOCX can contain different diagrams despite identical text.
    return plainText(candidate)&&plainText(material)&&typeof candidate.text==='string'
      &&normalizeText(candidate.text)===normalizeText(material.text);
  })||null;
}
