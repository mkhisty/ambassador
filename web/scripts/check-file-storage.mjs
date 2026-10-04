import { storageBucket } from '../lib/files.mjs';
try{console.log('Document bucket:',await storageBucket());}catch(error){console.error(error.message);process.exitCode=1;}
