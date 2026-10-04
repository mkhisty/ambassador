// File bytes travel directly to storage; app requests contain only metadata.
export async function uploadFile(file,{sponsorId=null,sponsors=null}={}){
  async function post(body){
    const response=await fetch('/api/documents/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Upload failed.');return result;
  }
  const prepared=await post({action:'prepare',name:file.name,size:file.size,sponsorId,purpose:sponsors?'import':'document'});
  let uploaded;
  try{uploaded=await fetch(prepared.uploadUrl,{method:'PUT',headers:prepared.headers,body:file});}
  catch{throw new Error('Cannot reach file storage. Check the bucket CORS configuration for this website.');}
  if(!uploaded.ok)throw new Error('File storage rejected the upload.');
  return post({action:'complete',uploadToken:prepared.uploadToken,...(sponsors?{sponsors}:{})});
}
