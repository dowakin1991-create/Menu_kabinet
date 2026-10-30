const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../js/',name),'utf8').replace(/import[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/export /g,'');
test('shift totals follow displayed exclusive type, including corrupt overlapping data',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(read('ui.js'),ctx);const total=vm.runInContext('shiftCount({shifts:[1],shiftsFirst:[1,2],shiftsSecond:[1,2,3]},1,15)',ctx);assert.equal(total,2);
});
test('SOHO shift is recognized and PNG draws red badge with black bold label',async()=>{
 const fills=[],labels=[];
 const ctx2d={scale(){},strokeRect(){},measureText:s=>({width:s.length*7}),beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},fillRect(x,y,w,h){fills.push({fill:this.fillStyle,w,h})},fillText(t){labels.push({text:t,color:this.fillStyle,font:this.font})}};
 const canvas={getContext:()=>ctx2d,toBlob:fn=>fn({type:'image/png'})};
 const nodes=[];
 const mk=tag=>{const n=tag==='canvas'?canvas:{style:{},append(){},addEventListener(){},showModal(){},remove(){},close(){}};nodes.push(n);return n};
 const context={document:{createElement:mk,body:{append(){}}},Image:function(){return mk('img')},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},daysInMonth:()=>31,monthLabel:()=> 'жовтень 2026',dutyName:()=> '🧽 Столи',shiftType:(emp,day)=>emp.shiftsSoho?.includes(day)?'soho':'none'};
 vm.createContext(context);vm.runInContext(read('export.js'),context);
 await context.exportHalfMonth(new Date(2026,9,1),{employees:[{name:'Настя',shiftsSoho:[30],unavail:[]}],banquets:{}},2);
 assert(fills.some(f=>f.fill==='#e00018'&&f.w===45&&f.h===20),'SOHO badge red background');
 assert(labels.some(l=>l.text==='SOHO'&&l.color==='#090909'&&/bold|900/.test(l.font)),'SOHO black bold label');
 const ui={};vm.createContext(ui);vm.runInContext(read('ui.js'),ui);
 assert.equal(vm.runInContext('shiftType({shifts:[],shiftsFirst:[],shiftsSecond:[],shiftsSoho:[30]},30)',ui),'soho');
});
test('PNG exporter includes correct February range and creates downloadable image',async()=>{
 const labels=[],nodes=[];
 const draw={scale(){},fillRect(){},strokeRect(){},fillText:s=>labels.push(s),measureText:s=>({width:s.length*7}),beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}};
 const node=tag=>{const n={tag,style:{},children:[],append(...kids){this.children.push(...kids)},addEventListener(){},showModal(){this.open=true},remove(){},close(){},getContext:()=>draw,toBlob:fn=>fn({type:'image/png'})};nodes.push(n);return n};
 const ctx={document:{createElement:node,body:node('body')},Image:function(){return node('img')},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},daysInMonth:d=>new Date(d.getFullYear(),d.getMonth()+1,0).getDate(),monthLabel:()=> 'лютий 2026',dutyName:()=> '🧽 Столи',shiftType:()=> 'full'};
 vm.createContext(ctx);vm.runInContext(read('export.js'),ctx);await ctx.exportHalfMonth(new Date(2026,1,1),{employees:[{name:'<b>Антон</b>',unavail:[20]}],banquets:{}},2);
 assert(labels.includes('KABINET · лютий 2026 · 16–28'));assert(labels.includes('<b>Антон</b>'));assert(nodes.some(n=>n.tag==='a'&&n.download==='kabinet-2026-02-16-28.png'));assert(nodes.some(n=>n.tag==='dialog'&&n.open));
});
test('every HTML module and relative import resolves locally',()=>{
 const root=path.join(__dirname,'..');
 for(const file of ['index.html','admin.html',...fs.readdirSync(path.join(root,'js')).map(f=>'js/'+f)]){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  const matches=file.endsWith('.html')?[...source.matchAll(/<script[^>]+src="([^"]+)"/g)]:[...source.matchAll(/from\s+["'](\.[^"']+)["']/g)];
  for(const [,value]of matches)assert(fs.existsSync(path.resolve(root,path.dirname(file),value.split('?')[0])),file+': '+value);
 }
});
