import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { MAX_FILE_BYTES } from './model.mjs';

export const MIME_TYPES={pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
export function validateFile(name,size) {
  if(!name||name.length>240||/[\x00-\x1f]/.test(name))throw new Error('Invalid file name.');
  const extension=name.split('.').at(-1).toLowerCase();
  if(!MIME_TYPES[extension])throw new Error('Upload PDF, DOCX, TXT, MD, CSV, or XLSX.');
  if(!Number.isInteger(size)||size<1||size>MAX_FILE_BYTES)throw new Error('Each file must be between 1 byte and 2 MB.');
  return MIME_TYPES[extension];
}
export function objectStorageReady(){return ['S3_ENDPOINT','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY'].every(k=>Boolean(process.env[k]));}
function client(){return new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION||'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});}
export async function storeObject(key,bytes,mime){await client().send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:bytes,ContentType:mime}));}
export async function readObject(key){const response=await client().send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));return Buffer.from(await response.Body.transformToByteArray());}
export async function removeObject(key){await client().send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));}
