// Copy only Gmail configuration to the already-linked Vercel project. Never
// print credentials, bypass URLs, existing environment values, or API bodies.
import { execFileSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

loadEnvFile(new URL('../.env.local',import.meta.url));
const origin=new URL(process.argv[2]).origin;
if(!origin.startsWith('https://'))throw new Error('An HTTPS website origin is required.');
const audience=origin+'/api/google/gmail/notifications';
const settings={
  GMAIL_PUBSUB_TOPIC:'projects/password-313816/topics/gmail-inbox',
  GMAIL_PUBSUB_SUBSCRIPTION:'projects/password-313816/subscriptions/gmail-inbox-ambassador',
  GMAIL_PUSH_SERVICE_ACCOUNT:'gmail-notifications@password-313816.iam.gserviceaccount.com',
  GMAIL_PUSH_AUDIENCE:audience,
  GOOGLE_CLIENT_ID:process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET:process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_TOKEN_ENCRYPTION_KEY:process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  GOOGLE_REDIRECT_URI:origin+'/api/google/callback',
};
if(Object.values(settings).some(v=>!v))throw new Error('Configure local Google credentials first.');
function run(command,args,input) {
  try {return execFileSync(command,args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});}
  catch(error) {
    let detail=String(error.stderr || '').slice(0,5000);
    for(const value of [...Object.values(settings),typeof bypass==='string'?bypass:''])if(value)detail=detail.replaceAll(value,'[redacted]');
    throw new Error(command+' configuration failed: '+detail);
  }
}
function update(file,values) {
  let content=existsSync(file)?readFileSync(file,'utf8'):'';
  for(const [name,value] of Object.entries(values)) {
    const line=name+'='+JSON.stringify(value);
    const expression=new RegExp('^'+name+'=.*$','m');
    content=expression.test(content)?content.replace(expression,()=>line):content+'\n'+line+'\n';
  }
  writeFileSync(file,content,{mode:0o600});
  chmodSync(file,0o600);
}
const agentFile=new URL('../../agent/.env.local',import.meta.url);
const existing=existsSync(agentFile)?readFileSync(agentFile,'utf8'):'';
const saved=/^VERCEL_AUTOMATION_BYPASS_SECRET="([A-Za-z0-9_-]+)"$/m.exec(existing)?.[1];
const bypass=saved || randomBytes(16).toString('hex');
if(!saved) {
  run('vercel',['api','/v1/projects/ambassador/protection-bypass','--method','PATCH','--input','-','--scope','malhars-projects-3fcc794f'],
    JSON.stringify({generate:{secret:bypass,note:'Ambassador Gmail webhook and agent'}}));
  update(agentFile,{VERCEL_AUTOMATION_BYPASS_SECRET:bypass});
}
for(const [name,value] of Object.entries(settings)) {
  run('vercel',['env','add',name,'production','--force','--yes'],value);
  console.log('Configured '+name+'.');
}
update(new URL('../.env.local',import.meta.url),Object.fromEntries(Object.entries(settings).filter(([key])=>key.startsWith('GMAIL_'))));
update(agentFile,{AMBASSADOR_WEB_URL:origin,GMAIL_INBOX_ENABLED:'1'});
const endpoint=new URL(audience);
endpoint.searchParams.set('x-vercel-protection-bypass',bypass);
run('gcloud',['pubsub','subscriptions','update','gmail-inbox-ambassador','--project=password-313816',
  '--push-endpoint='+endpoint.href,'--push-auth-service-account='+settings.GMAIL_PUSH_SERVICE_ACCOUNT,
  '--push-auth-token-audience='+audience]);
console.log('Authenticated Gmail push and agent access configured for '+origin+'.');
