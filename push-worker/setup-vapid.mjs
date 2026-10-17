// Run locally once. Secret travels through stdin to Cloudflare, never into a file or log.
import {spawnSync} from 'node:child_process';
const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
const vapid={subject:'mailto:dowakin1991@gmail.com',publicKey,privateKey:jwk.d};
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','put','VAPID_JSON'],{input:JSON.stringify(vapid),stdio:['pipe','inherit','inherit']});
process.exitCode=result.status??1;
