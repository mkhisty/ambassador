import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';

loadEnvFile(new URL('../.env.local',import.meta.url));
loadEnvFile(new URL('../../agent/.env.local',import.meta.url));
const base=process.env.AMBASSADOR_WEB_URL;
const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const headers={'Content-Type':'application/json',...(bypass?{'x-vercel-protection-bypass':bypass}:{})};
async function post(path,body,token) {
  return fetch(base+path,{method:'POST',headers:{...headers,...(token?{Authorization:'Bearer '+token}:{})},
    body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});
}
const webhook=await post('/api/google/gmail/notifications',{});
assert.equal(webhook.status,401,'Webhook must be reachable through protection and require Google authentication.');
const invalid=await post('/api/google/gmail/notifications',{},'not-a-google-token');
assert.equal(invalid.status,401);
const worker=await post('/api/agent/google/gmail/inbox',{action:'next'});
assert.equal(worker.status,401);
const authorized=await post('/api/agent/google/gmail/inbox',{action:'next'},process.env.AGENT_API_TOKEN);
assert.equal(authorized.status,200,'Authenticated worker must reach the deployed inbox endpoint.');
const result=await authorized.json();
assert.equal(result.ok,true);
assert.equal(result.maintenanceError,false,'Gmail watch/database maintenance must succeed.');
// A ready job is not acknowledged here. Its lease recovers naturally; only the
// real listener should create approval cards or mark messages processed.
console.log('Exact Vercel URL verified: deployment protection access, Google-token enforcement, worker authentication, and inbox database readiness.');
