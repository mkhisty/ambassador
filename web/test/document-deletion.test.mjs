import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentDeletion} from '../lib/documents.mjs';

function fakeDatabase(file,calls) {
  const sql=(strings,...params)=>{
    const query=strings.join('?');calls.push({query,params});
    return Promise.resolve(query.startsWith('SELECT')&&file?[file]:[]);
  };
  return ()=>sql;
}

test('document deletion removes the owned S3 object before deleting its database row',async()=>{
  const calls=[],db=fakeDatabase({object_key:'ambassador/users/%2B12025550100/file-id'},calls);
  const remove=async key=>calls.push({remove:key});
  const deleted=await createDocumentDeletion({db,remove})('file-id','+12025550100');
  assert.equal(deleted,true);
  assert.equal(calls[0].query.startsWith('SELECT'),true);
  assert.deepEqual(calls[1],{remove:'ambassador/users/%2B12025550100/file-id'});
  assert.equal(calls[2].query.startsWith('DELETE'),true);
  assert.deepEqual(calls[2].params,['file-id','+12025550100']);
});

test('missing or foreign documents never trigger S3 deletion or a database delete',async()=>{
  const calls=[],db=fakeDatabase(null,calls);
  const deleted=await createDocumentDeletion({db,remove:async key=>calls.push({remove:key})})('other-file','+12025550100');
  assert.equal(deleted,false);
  assert.equal(calls.length,1);
});

test('S3 failure keeps the document row so deletion can be retried',async()=>{
  const calls=[],db=fakeDatabase({object_key:'private/file'},calls);
  await assert.rejects(createDocumentDeletion({db,remove:async()=>{throw new Error('S3 unavailable');}})('file-id','+12025550100'),/S3 unavailable/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].query.startsWith('SELECT'),true);
});

test('legacy database-only documents can still be deleted',async()=>{
  const calls=[],db=fakeDatabase({object_key:null},calls);
  const deleted=await createDocumentDeletion({db,remove:async key=>calls.push({remove:key})})('old-file','+12025550100');
  assert.equal(deleted,true);
  assert.equal(calls.length,2);
  assert.equal(calls[1].query.startsWith('DELETE'),true);
});
