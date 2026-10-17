import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('real workerd sends push payload and never follows redirects',async()=>{
 const source=await readFile(new URL('../src/transport.js',import.meta.url),'utf8');
 let count=0;
 const mf=new Miniflare(convertV4MiniflareOptions({
  modules:true,compatibilityDate:'2026-10-01',
  script:source+`
  export default {async fetch(){
    const deps={send:sendPush};
    return deps.send('https://web.push.apple.com/test',{
      method:'POST',headers:{'content-type':'application/octet-stream'},
      body:new Uint8Array([1,2,3])
    });
  }};`,
  outboundService:async request=>{
   count++;
   assert.equal(request.method,'POST');
   assert.deepEqual([...new Uint8Array(await request.arrayBuffer())],[1,2,3]);
   return new Response(null,{status:count===1?201:302,headers:{Location:'https://example.com/never-follow'}});
  }
 }));
 try {
  assert.equal((await mf.dispatchFetch('http://localhost',{redirect:'manual'})).status,201);
  assert.equal((await mf.dispatchFetch('http://localhost',{redirect:'manual'})).status,302);
  assert.equal(count,2);
 } finally {await mf.dispose();}
});
