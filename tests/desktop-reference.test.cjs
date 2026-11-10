const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('approved owner desktop design is connected without replacing mobile admin panels',()=>{
 const html=read('admin.html'),css=read('desktop-reference.css');
 assert.match(html,/desktop-reference\.css\?v=20261110\.1/);
 assert(html.indexOf('desktop-reference.css')>html.indexOf('interface-polish.css'),'reference CSS loads after old overrides');
 for(const id of ['owner-panel','owner-users-panel','admin-tools-panel','admin-table','logout','pushNotifyBtn']){
   assert(html.includes('id="'+id+'"'),'preserve existing '+id);
 }
 assert.match(html,/class="desktop-owner-toolbar"/);
 assert.match(html,/class="desktop-profile-card"/);
 assert.match(html,/class="desktop-notice-bell"/);
 assert.match(html,/class="desktop-owner-tabs"/);
 assert.match(html,/class="desktop-dayoff-link"/);
 assert.match(css,/@media \(min-width:960px\)/);
 assert.match(css,/@media \(max-width:959px\)\{\.desktop-owner-toolbar\{display:none!important\}\}/);
 assert.match(css,/#admin-panel>\.table-wrapper/);
 assert.match(css,/#admin-panel>\.admin-tools-panel \{order:20/);
 assert.match(css,/\.desktop-owner-toolbar \{/);
});
test('desktop shortcuts preserve working notification command and route to real viewer controls',()=>{
 const admin=read('admin.html'),viewer=read('index.html'),route=read('js/desktop-deeplinks.js');
 assert.match(admin,/class="desktop-notice-bell" onclick="notifyTeam\(\)"/);
 assert.match(admin,/href="index\.html#personal-view"/);
 assert.match(admin,/href="index\.html#day-off"/);
 assert.match(viewer,/id="personal-view"/);
 assert.match(viewer,/id="redDotToggleBtn"/);
 assert.match(viewer,/desktop-deeplinks\.js\?v=20261110\.1/);
 assert.match(route,/window\.showPersonalView\(\)/);
 assert.match(route,/button\.focus/);
 assert.doesNotMatch(route,/setDoc|updateSchedule|setAvailability|toggleRedDotMode/);
});
