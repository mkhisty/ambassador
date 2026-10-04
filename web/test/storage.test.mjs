import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { neonConfig } from '@neondatabase/serverless';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { saveDocument } from '../lib/documents.mjs';
import { storageConfig, storageBucket } from '../lib/files.mjs';
import { database, contactImportQueries } from '../lib/db.mjs';

test('Uploads require S3 and contact imports archive original bytes atomically',async t=>{
  const keys=['DATABASE_URL','S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','AWS_ENDPOINT_URL_S3','AWS_S3_BUCKET','AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const fetchFunction=neonConfig.fetchFunction;
  try {
    process.env.DATABASE_URL='postgresql://test:test@example.neon.tech/test';
    for(const key of keys.filter(key=>key!=='DATABASE_URL'))delete process.env[key];
    const send=mock.method(S3Client.prototype,'send',async()=>({}));
    const file=new File(['contact,email\nAlex,alex@example.com'],'contacts.csv');
    await t.test('Missing bucket settings never fall back to database bytes',async()=>{
      await assert.rejects(()=>saveDocument(file,'+12025550100'),error=>error.status===503);
      assert.equal(send.mock.callCount(),0);
    });
    Object.assign(process.env,{S3_ENDPOINT:'https://storage.example.test',S3_BUCKET:'private-files',S3_REGION:'us-east-1',S3_ACCESS_KEY_ID:'test',S3_SECRET_ACCESS_KEY:'test'});
    let transaction;
    neonConfig.fetchFunction=async(url,options)=>{
      transaction=JSON.parse(options.body);
      return Response.json({results:transaction.queries.map(()=>({fields:[],rows:[],rowCount:1,command:'INSERT'}))});
    };
    await t.test('Original spreadsheet bytes go to S3; contact rows and file metadata share a transaction',async()=>{
      const queries=contactImportQueries(database(),[{contact:'Alex',address:'alex@example.com'}]);
      const result=await saveDocument(file,'+12025550100',{queries});
      const command=send.mock.calls.at(-1).arguments[0];
      assert.ok(command instanceof PutObjectCommand);
      assert.equal(command.input.Bucket,'private-files');
      assert.ok(command.input.Key.startsWith('ambassador/users/%2B12025550100/'));
      assert.equal(command.input.Body.toString(),await file.text());
      assert.equal(transaction.queries.length,2);
      assert.match(transaction.queries[0].query,/ambassador_sponsors/);
      assert.match(transaction.queries[1].query,/,NULL\)/);
      assert.equal(result.ownerPhoneNumber,'+12025550100');
      assert.equal(result.storage,'S3 bucket');
    });
    await t.test('Failed database transaction removes its newly uploaded object',async()=>{
      neonConfig.fetchFunction=async()=>Response.json({message:'Simulated database failure',code:'23503'},{status:400});
      await assert.rejects(()=>saveDocument(file,'+12025550100'));
      const calls=send.mock.calls.slice(-2).map(call=>call.arguments[0]);
      assert.ok(calls[0] instanceof PutObjectCommand);
      assert.ok(calls[1] instanceof DeleteObjectCommand);
      assert.equal(calls[0].input.Key,calls[1].input.Key);
    });
    await t.test('Failed bucket write never commits file metadata',async()=>{
      let databaseCalls=0;
      neonConfig.fetchFunction=async()=>{databaseCalls++;throw new Error('Unexpected database write');};
      send.mock.mockImplementation(async()=>{throw new Error('S3 unavailable');});
      await assert.rejects(()=>saveDocument(file,'+12025550100'),/S3 unavailable/);
      assert.equal(databaseCalls,0);
    });
    send.mock.restore();
  }finally{
    neonConfig.fetchFunction=fetchFunction;
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
    mock.restoreAll();
  }
});

test('Storage accepts Neon AWS environment variables and selects only an unambiguous bucket',async()=>{
  const config=storageConfig({AWS_ENDPOINT_URL_S3:'https://storage.example',AWS_ACCESS_KEY_ID:'test-id',AWS_SECRET_ACCESS_KEY:'test-secret',AWS_REGION:'us-east-2'});
  assert.equal(config.endpoint,'https://storage.example');assert.equal(config.region,'us-east-2');assert.equal(config.accessKeyId,'test-id');assert.equal(config.secretAccessKey,'test-secret');
  assert.equal(storageConfig({...{AWS_ENDPOINT_URL_S3:'aws'},S3_ENDPOINT:'legacy'}).endpoint,'legacy');
  const previous=[process.env.S3_BUCKET,process.env.AWS_S3_BUCKET];delete process.env.S3_BUCKET;delete process.env.AWS_S3_BUCKET;
  try{
    assert.equal(await storageBucket({send:async()=>({Buckets:[{Name:'context'}]})}),'context');
    await assert.rejects(storageBucket({send:async()=>({Buckets:[]})}),/No bucket/);
    await assert.rejects(storageBucket({send:async()=>({Buckets:[{Name:'one'},{Name:'two'}]})}),/Multiple buckets/);
    await assert.rejects(storageBucket({send:async()=>{throw new Error('denied');}}),/AWS_S3_BUCKET/);
    process.env.AWS_S3_BUCKET='selected';assert.equal(await storageBucket({send:()=>{throw new Error('Should not list');}}),'selected');
  }finally{for(const [i,key] of ['S3_BUCKET','AWS_S3_BUCKET'].entries()){if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}}
});
