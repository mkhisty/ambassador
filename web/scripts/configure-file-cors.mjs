import { configureCors } from '../lib/files.mjs';
const origins=process.argv.slice(2);
if(!origins.length||origins.some(o=>new URL(o).origin!==o))throw new Error('Pass exact website origins, for example https://your-site.vercel.app http://127.0.0.1:3000');
await configureCors(origins);
console.log('Bucket browser upload/download origins configured.');
