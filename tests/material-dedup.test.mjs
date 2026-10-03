import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateMaterial, fingerprintUpload } from '../src/material-dedup.mjs';

test('identical bytes with another filename are duplicates',async()=>{
  const bytes=new TextEncoder().encode('the same document'),fingerprint=await fingerprintUpload(bytes);
  assert.equal(fingerprint.length,64);
  const original={name:'lecture.pdf',fingerprint};
  assert.equal(duplicateMaterial({name:'copy.pdf',fingerprint:await fingerprintUpload(bytes)},[original]),original);
});
test('same-batch duplicates are found as each accepted file joins the collection',()=>{
  const materials=[];const candidate={type:'txt',text:'Notes',fingerprint:'hash'};
  assert.equal(duplicateMaterial(candidate,materials),null);materials.push(candidate);
  assert.equal(duplicateMaterial(candidate,materials),candidate);
});
test('renamed old text notes need no stored hash and normalize line endings',()=>{
  const original={name:'old.txt',text:'A\r\nB'};
  assert.equal(duplicateMaterial({name:'new.md',text:'A\nB'},[original]),original);
});
test('same name and length do not hide changed contents',async()=>{
  const original={name:'notes.txt',text:'A',fingerprint:await fingerprintUpload(new TextEncoder().encode('A'))};
  assert.equal(duplicateMaterial({name:'notes.txt',text:'B',fingerprint:await fingerprintUpload(new TextEncoder().encode('B'))},[original]),null);
});
test('PDFs with different bytes and identical extracted text may have different diagrams',()=>{
  assert.equal(duplicateMaterial({name:'a.pdf',text:'Figure',fingerprint:'a'},[{name:'a.pdf',text:'Figure',fingerprint:'b'}]),null);
});
test('legacy imports still skip the same filename, size and extracted text',()=>{
  const legacy={name:'notes.pdf',size:400,text:'A page'};
  assert.equal(duplicateMaterial({...legacy,fingerprint:'newly-computed'},[legacy]),legacy);
  assert.equal(duplicateMaterial({...legacy,text:'Revised page',fingerprint:'new'},[legacy]),null);
});
