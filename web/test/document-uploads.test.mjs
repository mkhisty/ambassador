import test from 'node:test';
import assert from 'node:assert/strict';
import {createUploadService,decodeUpload} from '../lib/document-uploads.mjs';
import {validateFile} from '../lib/files.mjs';

test('Large direct uploads bind ownership, freeze verified bytes, and reject altered metadata',async()=>{
  const old=process.env.SESSION_SECRET;process.env.SESSION_SECRET='s'.repeat(32);
  const owner='+12025550100',calls=[];let size=10*1024*1024,existing=null;
  const sql=(strings,...params)=>{calls.push({query:strings.join('?'),params});return Promise.resolve(strings.join('').startsWith('SELECT')?(existing?[existing]:[]):[]);};
  sql.transaction=async statements=>Promise.all(statements);
  const service=createUploadService({db:()=>sql,sign:async(key,mime)=>{assert.ok(key.includes(encodeURIComponent(owner)));assert.equal(mime,'application/pdf');return 'https://bucket.example/signed';},inspect:async key=>{calls.push({inspect:key});return {ContentLength:size,ContentType:'application/pdf'};},copy:async(from,to)=>{calls.push({copy:[from,to]});},remove:async key=>calls.push({remove:key})});
  try{
    assert.equal(validateFile('large.pdf',size),'application/pdf');
    assert.throws(()=>validateFile('empty.pdf',0));
    const upload=await service.prepare({name:'large.pdf',size,owner:'+12025550999'},owner);
    assert.equal(decodeUpload(upload.uploadToken,owner).owner,owner);
    assert.throws(()=>decodeUpload(upload.uploadToken,'+12025550999'),/another account/);
    assert.throws(()=>decodeUpload(upload.uploadToken+'x',owner),/Invalid/);
    const now=Date.now;Date.now=()=>now()+1000000;
    try{assert.throws(()=>decodeUpload(upload.uploadToken,owner),/expired/);}finally{Date.now=now;}
    size++;
    await assert.rejects(service.complete(upload.uploadToken,owner),/metadata/);
    assert.equal(calls.filter(c=>c.copy).length,0);
    size--;
    const result=await service.complete(upload.uploadToken,owner);
    assert.equal(result.size,size);
    const copy=calls.find(c=>c.copy).copy;assert.equal(copy[0],copy[1]+'/upload');
    assert.ok(calls.some(c=>c.query?.startsWith('INSERT')&&c.params.includes(size)));
    assert.ok(calls.some(c=>c.remove===copy[0]));
    existing={id:result.id,name:result.name,mime:result.mime,size:String(size),owner_phone_number:owner,object_key:copy[1],created_at:new Date()};
    assert.equal((await service.complete(upload.uploadToken,owner)).size,size);
    assert.equal(calls.filter(c=>c.copy).length,1);
  }finally{if(old===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=old;}
});
