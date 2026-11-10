const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('admin and employee areas are separate after desktop rollback',()=>{
  const home=read('index.html'),admin=read('admin.html');
  for(const html of [home,admin]){
    assert.match(html,/desktop-stability\.css\?v=20261110\.rollback1/);
    assert.doesNotMatch(html,/desktop-reference\.css/);
    assert.doesNotMatch(html,/desktop-repair\.css/);
    assert.doesNotMatch(html,/class="desktop-owner-toolbar"/);
    assert.doesNotMatch(html,/class="desktop-owner-shortcuts"/);
    assert.doesNotMatch(html,/desktop-deeplinks\.js|admin-deeplinks\.js/);
  }
  assert.match(home,/id="private-schedule"/);
  assert.match(home,/id="schedule-tab"/);
  assert.match(home,/id="personal-tab"/);
  assert.match(home,/id="redDotToggleBtn"/);
  assert.match(home,/id="schedule"/);
  assert.match(admin,/id="admin-panel"/);
  assert.match(admin,/id="admin-table"/);
  assert.match(admin,/id="owner-panel"/);
  assert.match(admin,/id="owner-users-panel"/);
  assert.match(admin,/id="pushNotifyBtn"/);
});
test('first employee column is sticky and buttons use normal desktop document flow',()=>{
  const css=read('desktop-stability.css');
  assert.match(css,/position:sticky!important/);
  assert.match(css,/left:0!important/);
  assert.match(css,/overflow:visible!important/);
  assert.match(css,/position:static!important/);
  assert.match(css,/#schedule-view #redDotToggleBtn/);
  assert.match(css,/#private-schedule \.worker-tabs/);
  assert.match(css,/@media \(min-width:960px\)/);
  assert.doesNotMatch(css,/setDoc\(|firebase|localStorage/);
});
