import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output='benchmarks/tutor-quality/grade-assistance-evidence-fixtures.json';
try{await readFile(output);throw Error('Refusing to replace frozen assistance fixtures.');}catch(error){if(error.code!=='ENOENT')throw error;}
const source='benchmarks/tutor-quality/grade-restatement-fixtures.json',raw=await readFile(source,'utf8'),previous=JSON.parse(raw),sha=value=>createHash('sha256').update(value).digest('hex');
const cases=previous.cases.filter(item=>item.instructionVersion==='after').map(({instructionVersion,...item})=>({...item,id:item.id.replace(/^after-/,'evidence-'),inputSha256:sha(JSON.stringify(item.input))}));
if(cases.length!==6)throw Error('Expected six predeclared assistance conditions.');
await writeFile(output,JSON.stringify({createdAt:new Date().toISOString(),method:'Six frozen diagnostic conditions, each independently judged twice with production low-effort Luna. w/y use byte-identical captured final grading inputs; controls retain same-ID help, renamed-target help, unrelated teaching, and worked solution followed by restatement. Complete public history stays visible. No score writes. IDs authenticate prior tutor wording; semantic target attribution remains model judgment.',source,sourceSha256:sha(raw),originalAdaptiveSource:previous.source,originalAdaptiveSha256:previous.sourceSha256,cases},null,2)+'\n');
console.log(JSON.stringify({output,cases:cases.length}));
