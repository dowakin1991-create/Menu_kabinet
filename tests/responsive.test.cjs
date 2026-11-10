const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const css=fs.readFileSync(path.join(root,'responsive.css'),'utf8');
test('both pages omit redundant schedule toolbar while retaining scrollable tables',()=>{
 for(const page of ['admin.html','index.html']){
   const html=fs.readFileSync(path.join(root,page),'utf8');
   assert.match(html,/responsive\.css\?v=20261110\.2/);
   assert.match(html,/class="table-wrapper"/);
   assert.doesNotMatch(html,/class="schedule-scroll-controls"/);
   assert.doesNotMatch(html,/js\/schedule-viewport\.js/);
 }
});
test('responsive schedule keeps names fixed and supplies distinct desktop, tablet and mobile breakpoints',()=>{
 assert.match(css,/\.table-wrapper table th:first-child/);
 assert.match(css,/\.table-wrapper table td:first-child/);
 assert.match(css,/@media \(min-width:960px\)/);
 assert.match(css,/@media \(min-width:601px\) and \(max-width:959px\)/);
 assert.match(css,/@media \(max-width:600px\)/);
 assert.match(css,/overflow-x:auto/);
 assert.match(css,/scrollbar-width:thin/);
});
test('desktop corrections are loaded after themes and leave mobile layout untouched',()=>{
 const desktop=fs.readFileSync(path.join(root,'desktop-layout.css'),'utf8');
 assert.match(desktop,/@media \(min-width:960px\)/);
 assert.match(desktop,/max-width:1380px/);
 assert.match(desktop,/#private-schedule \.worker-tabs/);
 assert.match(desktop,/#redDotToggleBtn/);
 assert.doesNotMatch(desktop,/@media \(max-width:600px\)/);
 for(const page of ['index.html','admin.html']){
   const html=fs.readFileSync(path.join(root,page),'utf8');
   const theme=html.indexOf('assets/glass.css?v=');
   const desktopLink=html.indexOf('desktop-layout.css?v=20261110.1');
   assert(theme>=0 && desktopLink>theme,'desktop overrides must load after glass theme');
 }
});

test('final interface polish is last stylesheet on both pages and preserves application controls',()=>{
 const css=fs.readFileSync(path.join(root,'interface-polish.css'),'utf8');
 assert.match(css,/\.table-wrapper thead th:first-child/);
 assert.match(css,/text-align:center!important/);
 assert.match(css,/\.unavailable,/);
 assert.match(css,/\.unavail-marker/);
 assert.match(css,/position:absolute!important/);
 assert.match(css,/border-top:0!important/);
 assert.match(css,/@media \(min-width:960px\)/);
 assert.match(css,/#redDotToggleBtn\[hidden\]/);
 for(const page of ['index.html','admin.html']){
   const html=fs.readFileSync(path.join(root,page),'utf8');
   assert.match(html,/interface-polish\.css\?v=20261110\.1/);
   assert(html.indexOf('interface-polish.css')>html.indexOf('assets/glass.css'));
   assert.match(html,/class="table-wrapper"/);
 }
 const admin=fs.readFileSync(path.join(root,'admin.html'),'utf8');
 const viewer=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(viewer,/id="redDotToggleBtn"/);
 assert.match(admin,/id="admin-table"/);
 assert.match(viewer,/id="schedule"/);
});
