const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const css=fs.readFileSync(path.join(root,'responsive.css'),'utf8');
const js=fs.readFileSync(path.join(root,'js/schedule-viewport.js'),'utf8');
test('both KABINET pages load the responsive layout and independent schedule navigation',()=>{
 for(const page of ['admin.html','index.html']){
   const html=fs.readFileSync(path.join(root,page),'utf8');
   assert.match(html,/responsive\.css\?v=20261110\.2/);
   assert.match(html,/js\/schedule-viewport\.js\?v=20261110\.2/);
   assert.match(html,/class="schedule-scroll-controls"/);
   assert.match(html,/data-scroll="left"/);
   assert.match(html,/data-scroll="right"/);
   assert.match(html,/data-scroll="first"/);
   assert.match(html,/data-scroll="second"/);
   assert(html.indexOf('class="schedule-scroll-controls"')<html.indexOf('class="table-wrapper"'));
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
test('table navigation moves the schedule only, without changing schedule values or auth',()=>{
 assert.match(js,/wrapper\.scrollBy/);
 assert.match(js,/jumpToDay\(16\)/);
 assert.match(js,/wrapper\.scrollLeft/);
 assert.match(js,/wrapper\.scrollWidth/);
 assert.doesNotMatch(js,/getFirestore|setDoc\s*\(|localStorage|sessionStorage|setShiftType|updateSchedule|logout\s*\(/i);
});
