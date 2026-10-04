import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand, GetBucketCorsCommand, PutBucketCorsCommand, ListBucketsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const MIME_TYPES={pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
export function validateFile(name,size) {
  if(typeof name!=='string'||!name||name.length>240||/[\x00-\x1f]/.test(name))throw new Error('Invalid file name.');
  const extension=name.split('.').at(-1).toLowerCase();
  if(!MIME_TYPES[extension])throw new Error('Upload PDF, DOCX, TXT, MD, CSV, or XLSX.');
  if(!Number.isSafeInteger(size)||size<1)throw new Error('File size must be a positive, safe integer.');
  return MIME_TYPES[extension];
}
export function storageConfig(env=process.env){
  return {endpoint:env.S3_ENDPOINT||env.AWS_ENDPOINT_URL_S3,bucket:env.S3_BUCKET||env.AWS_S3_BUCKET,region:env.S3_REGION||env.AWS_REGION||'us-east-1',accessKeyId:env.S3_ACCESS_KEY_ID||env.AWS_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY||env.AWS_SECRET_ACCESS_KEY};
}
export function objectStorageReady(){const c=storageConfig();return Boolean(c.endpoint&&c.accessKeyId&&c.secretAccessKey);}
export function requireObjectStorage(){if(!objectStorageReady()){const error=new Error('File storage is not configured. Set AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY (or their S3_* equivalents).');error.status=503;throw error;}}
function client(){requireObjectStorage();const c=storageConfig();return new S3Client({endpoint:c.endpoint,region:c.region,forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED',credentials:{accessKeyId:c.accessKeyId,secretAccessKey:c.secretAccessKey}});}
export async function storageBucket(s3=client()){
  const configured=storageConfig().bucket;if(configured)return configured;
  let buckets;
  try{const result=await s3.send(new ListBucketsCommand({}));buckets=result.Buckets||[];if(result.ContinuationToken)throw new Error('Multiple pages of buckets.');}
  catch{throw new Error('Set AWS_S3_BUCKET to your bucket name; automatic bucket lookup was unavailable.');}
  if(buckets.length!==1||!buckets[0].Name)throw new Error(buckets.length?'Multiple buckets found. Set AWS_S3_BUCKET to the document bucket name.':'No bucket found. Create a private bucket in Neon, then set AWS_S3_BUCKET to its name.');
  return buckets[0].Name;
}
export async function storeObject(key,bytes,mime){await client().send(new PutObjectCommand({Bucket:await storageBucket(),Key:key,Body:bytes,ContentType:mime}));}
export async function readObject(key){const response=await client().send(new GetObjectCommand({Bucket:await storageBucket(),Key:key}));return Buffer.from(await response.Body.transformToByteArray());}
export async function removeObject(key){await client().send(new DeleteObjectCommand({Bucket:await storageBucket(),Key:key}));}

export async function uploadUrl(key,mime){return getSignedUrl(client(),new PutObjectCommand({Bucket:await storageBucket(),Key:key,ContentType:mime}),{expiresIn:900});}
export async function downloadUrl(key,name){return getSignedUrl(client(),new GetObjectCommand({Bucket:await storageBucket(),Key:key,ResponseContentDisposition:`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(name)}`}),{expiresIn:900});}
export async function inspectObject(key){return client().send(new HeadObjectCommand({Bucket:await storageBucket(),Key:key}));}
export async function copyObject(source,key,etag){const bucket=await storageBucket();return client().send(new CopyObjectCommand({Bucket:bucket,Key:key,...(etag?{CopySourceIfMatch:etag}:{}),CopySource:`${bucket}/${source.split('/').map(encodeURIComponent).join('/')}`}));}
export async function configureCors(origins){
  const s3=client(),bucket=await storageBucket(s3);let existing=[];
  try{existing=(await s3.send(new GetBucketCorsCommand({Bucket:bucket}))).CORSRules||[];}catch(e){if(e.name!=='NoSuchCORSConfiguration')throw e;}
  const rule={AllowedOrigins:origins,AllowedMethods:['PUT','GET','HEAD'],AllowedHeaders:['content-type','x-amz-*'],ExposeHeaders:['ETag'],MaxAgeSeconds:3600};
  await s3.send(new PutBucketCorsCommand({Bucket:bucket,CORSConfiguration:{CORSRules:[...existing.filter(r=>r.ID!=='ambassador-browser'),{...rule,ID:'ambassador-browser'}]}}));
}
