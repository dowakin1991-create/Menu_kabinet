import {initPush, setPushAccess, disconnectPush, notifySchedule} from './push.js?v=20261017.11';
import { watchTeamAccess, watchViewerAccess, syncTeamAccess } from './access.js?v=20261017.13';
import { initOwnerPanel } from './owner.js?v=20261017.5';
import { initAccount, openAccount, setScheduleAccess } from './account.js?v=20261017.5';
import { isOwner, currentUser, canEditWorker, ensureWorkerSession, isAdmin, login, logout, watchAuth } from './auth.js?v=20261017.5';
import { ensureMonthRoster, moveEmployee, subscribeSchedule, monthId, updateSchedule, setAvailability, employeeAccess, bindEmployee, bindOwnerEmployee, addReceipt, deleteReceipt, removeBanquet, readReceipt } from './store.js?v=20261017.10';
import { dutyName as getDutyName, shiftCount, toast } from './ui.js?v=20261015.2';
import { withBusy, recordChange, changeJournal, clearChangeJournal } from './session.js?v=20261017.4';
import { compressReceipt } from './receipts.js?v=20261015.2';
import { exportHalfMonth as exportPNG } from './export.js?v=20261017.13';

function renderRoleBadge(user) {
  const badge = document.getElementById('role-badge');
  const label = isOwner(user) ? 'Власник' : isAdmin(user) ? 'Шеф' : '';
  badge.textContent = label;
  badge.hidden = !label;
  badge.dataset.role = isOwner(user) ? 'owner' : 'admin';
  if (document.body.dataset.page === 'admin') document.title = label ? `KABINET — ${label}` : 'KABINET — Вхід';
}
const admin = document.body.dataset.page === 'admin';
const $ = id => document.getElementById(id);
const monthNames = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const dayNames = ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'];
let todayDate = new Date();
const notificationTarget = (()=>{try{const url=new URL(location.href),month=url.searchParams.get('month'),day=Number(url.searchParams.get('day')),endDay=Number(url.searchParams.get('endDay')),rawDays=url.searchParams.get('days');if(/^20\d\d-(0[1-9]|1[0-2])$/.test(month||'')&&Number.isInteger(day)&&day>0&&day<=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate())return{month,day,endDay:Number.isInteger(endDay)&&endDay>=day&&endDay<=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()?endDay:day,days:rawDays&&/^\d{1,2}(,\d{1,2})*$/.test(rawDays)?rawDays.split(',').map(Number).filter(d=>d>=1&&d<=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()):null};}catch{}return null;})();
let currentDate = notificationTarget ? new Date(Number(notificationTarget.month.slice(0,4)),Number(notificationTarget.month.slice(5,7))-1,1) : new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
let employees = [], banquets = {}, unsubscribe = null, generation = 0;
let stopViewerAccess=null,viewerMode=false;
let stopTeamAccess = null, accessGeneration = 0, boundEmployeeId = null;
let ready = false, allowed = false, loadError = false, initialScrollDone = false;
let activeColDay = null, activeRowEmpId = null, isRedDotMode = false;
let pendingAction = null, currentEditEmpId = null, currentEditDay = null, currentSettingsDay = null, currentReceiptDay = null;
const getDocId = () => monthId(currentDate);
const findEmployee = id => employees.find(e => String(e.id) === String(id));
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeId = value => escapeHTML(JSON.stringify(value));
const emptyMessage = () => loadError ? 'Не вдалося завантажити графік. Натисніть «Повторити».' : ready ? 'У цьому місяці ще немає працівників.' : '⏳ Завантаження графіка…';
const show = id => { $(id).style.display = 'flex'; };
const hide = id => { $(id).style.display = 'none'; };
function status(text, error = false) {
  $('connection-status').querySelector('span').textContent = text;
  $('connection-status').className = error ? 'error' : '';
  $('retry-load').hidden = !error;
}
function render() {
  $('month-label').textContent = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  if (admin) renderAdmin(); else renderIndex();
}
let notificationFocusTimer;
function focusNotificationDay(day,endDay=day,days=null) {
  const wrapper=$('schedule-view');
  if(wrapper?.hidden) return;
  document.querySelectorAll('.notification-focus').forEach(node=>node.classList.remove('notification-focus'));
  const nodes=[...document.querySelectorAll('[data-day]')].filter(node=>days?.length?days.includes(Number(node.dataset.day)):Number(node.dataset.day)>=day&&Number(node.dataset.day)<=endDay);
  nodes.forEach(node=>node.classList.add('notification-focus'));
  const th=document.querySelector(`#header-row [data-day="${day}"]`);
  if(th) th.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
  clearTimeout(notificationFocusTimer);
  notificationFocusTimer=setTimeout(()=>nodes.forEach(node=>node.classList.remove('notification-focus')),4200);
}
window.showScheduleView=()=>{if($('schedule-view'))$('schedule-view').hidden=false;if($('personal-view'))$('personal-view').hidden=true;$('schedule-tab')?.setAttribute('aria-pressed','true');$('personal-tab')?.setAttribute('aria-pressed','false');};
window.showPersonalView=()=>{if($('schedule-view'))$('schedule-view').hidden=true;if($('personal-view'))$('personal-view').hidden=false;$('schedule-tab')?.setAttribute('aria-pressed','false');$('personal-tab')?.setAttribute('aria-pressed','true');renderPersonalDashboard();};
function renderPersonalDashboard(){
  $('month-label-profile').textContent=`${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  const employee=employees.find(item=>String(item.id)===String(boundEmployeeId));
  if(!employee){$('personal-title').textContent='Персональний кабінет';$('personal-days').textContent='0';$('personal-breakdown').textContent='Працівника ще не прив’язано до облікового запису.';$('personal-chart').replaceChildren();return;}
  const year=currentDate.getFullYear(),month=currentDate.getMonth(),totalDays=new Date(year,month+1,0).getDate();
  const full=new Set(employee.shifts),first=new Set(employee.shiftsFirst),second=new Set(employee.shiftsSecond);
  const count=full.size+(first.size+second.size)/2;
  $('personal-title').textContent=employee.name;
  $('personal-heading').textContent=`Особиста статистика · ${employee.name}`;
  $('personal-days').textContent=Number.isInteger(count)?String(count):count.toFixed(1).replace('.',',');
  $('personal-breakdown').textContent=`${full.size} повних · ${first.size} перших половин · ${second.size} других половин`;
  const chart=$('personal-chart');chart.replaceChildren();chart.setAttribute('aria-label',`Діаграма змін за ${monthNames[month]} ${year}`);
  for(let day=1;day<=totalDays;day++){
    const value=full.has(day)?1:(first.has(day)||second.has(day))?.5:0;
    const column=document.createElement('div');column.className='personal-bar-column';
    const bar=document.createElement('span');bar.className='personal-bar'+(value?' is-work':'');bar.style.setProperty('--bar-height',`${Math.max(value*100,4)}%`);bar.title=`${day}: ${value===1?'1 день':value===.5?'½ дня':'без зміни'}`;
    const label=document.createElement('small');label.textContent=String(day);
    column.append(bar,label);chart.append(column);
  }
}

function installOwnerSelfBinding() {
  const panel=$('owner-panel');
  if (!panel || $('owner-self-binding')) return;
  const section=document.createElement('section');section.id='owner-self-binding';
  section.innerHTML='<h3>Моє ім’я в графіку</h3><p>Оберіть своє ім’я серед уже доданих працівників.</p><select id="owner-self-select" aria-label="Моє ім’я в графіку"></select><button id="owner-self-save" type="button">Прив’язати моє ім’я</button><p id="owner-self-status" role="status"></p>';
  panel.insertBefore(section,$('owner-requests'));
  $('owner-self-save').addEventListener('click',action(async()=>{
    if (!isOwner(currentUser())) return;
    const id=$('owner-self-select').value;
    if (!employees.some(e=>String(e.id)===id)) throw new Error('Оберіть ім’я.');
    await bindOwnerEmployee(employees.map(e=>e.id),id,currentUser().uid);
    boundEmployeeId=id;
    $('owner-self-status').textContent='Ваш акаунт прив’язано до обраного імені.';
  }));
}
function renderOwnerSelfBinding() {
  const section=$('owner-self-binding');if(!section)return;
  section.hidden=!isOwner(currentUser());
  const select=$('owner-self-select'),value=boundEmployeeId || select.value;
  select.replaceChildren(new Option('Оберіть ім’я',''));
  for(const e of employees)select.add(new Option(e.name,String(e.id)));
  if([...select.options].some(o=>o.value===value))select.value=value;
}

function closeAll() {
  document.querySelectorAll('.modal-overlay').forEach(node => { node.style.display = 'none'; });
  pendingAction = null; currentEditEmpId = null; currentEditDay = null; currentSettingsDay = null; currentReceiptDay = null;
}
function clearPrivateContent() {
  for (const id of ['header-row','body-row','h-row','b-row','infoModalName','receiptImagesContainer','legacy-receipts','resultImageContainer']) {
    const node=$(id); if(node) {node.ticket=null;node.replaceChildren();}
  }
}
async function loadData() {
  unsubscribe?.();
  const ticket = ++generation;
  ready = false; loadError = false; employees = []; banquets = {}; closeAll(); render();
  if (!allowed) return;
  status('Підключення…');
  if (admin) {
    try { await ensureMonthRoster(getDocId()); }
    catch (error) {
      if (ticket !== generation) return;
      console.error(error); loadError = true; render();
      toast('Не вдалося перенести список із попереднього місяця. Можна додати працівників вручну.', 'error');
    }
    if (ticket !== generation || !allowed) return;
  }
  unsubscribe = subscribeSchedule(getDocId(), data => {
    if (ticket !== generation) return;
    employees = data.employees; banquets = data.banquets; ready = true; loadError = false;
    status('Дані актуальні'); render(); renderOwnerSelfBinding();
    if($('personal-view')&&!$('personal-view').hidden)renderPersonalDashboard();
    if(!admin&&notificationTarget&&getDocId()===notificationTarget.month){focusNotificationDay(notificationTarget.day,notificationTarget.endDay,notificationTarget.days);history.replaceState(null,'',location.pathname+location.hash);}
    if (admin && currentSettingsDay !== null && $('daySettingsModal').style.display === 'flex') renderDaySettings();
    if (!admin && currentReceiptDay !== null && $('receiptModal').style.display === 'flex') renderWorkerReceipts();
  }, error => {
    if (ticket !== generation) return;
    console.error(error); ready = false; loadError = true; employees = []; banquets = {};
    closeAll(); render();
    const denied=error?.code==='permission-denied';
    const offline=error?.code==='unavailable' || (typeof navigator!=='undefined' && !navigator.onLine);
    const message=denied?'Firestore відхилив читання графіка. Перевірте опубліковані Rules і прив’язку працівника.':offline?'Немає з’єднання з Firebase. Перевірте інтернет і повторіть.':`Не вдалося завантажити графік (${error?.code || 'невідома помилка'}).`;
    status(message,true);
    toast(message,'error');
  });
}
function action(fn) {
  return withBusy(async (...args) => {
    if (!ready || !allowed) return toast('Дочекайтеся завантаження графіка.', 'error');
    try { return await fn(...args); }
    catch (error) {
      console.error(error);
      toast(error.code === 'permission-denied' ? 'Немає дозволу. Адміністратор має прив’язати ваш код доступу до працівника.' : error.message || 'Не вдалося зберегти. Спробуйте ще раз.', 'error');
    }
  });
}
let draggedEmployee = null;
const saveEmployeeOrder = action(async (id, target, after, month) => {
  if (!admin) return;
  await moveEmployee(month, id, target, after);
  toast('Порядок працівників збережено');
});
window.moveEmployeeRow = (event, id, direction) => {
  event.stopPropagation();
  const index = employees.findIndex(e => String(e.id) === String(id));
  const target = employees[index + direction];
  if (index < 0 || !target) return;
  return saveEmployeeOrder(id, target.id, direction > 0, getDocId());
};
window.startEmployeeDrag = (event, id) => {
  if (!admin || !ready || !allowed || document.documentElement.dataset.saving) { event.preventDefault(); return; }
  draggedEmployee = {id, month: getDocId()};
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(id));
};
window.overEmployeeRow = event => {
  if (!draggedEmployee) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const row = event.currentTarget;
  const after = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
  row.classList.toggle('drop-after', after);
  row.classList.toggle('drop-before', !after);
};
window.leaveEmployeeRow = event => event.currentTarget.classList.remove('drop-before', 'drop-after');
window.endEmployeeDrag = () => {
  draggedEmployee = null;
  document.querySelectorAll('.drop-before,.drop-after').forEach(row => row.classList.remove('drop-before','drop-after'));
};
window.dropEmployeeRow = (event, target) => {
  event.preventDefault(); event.stopPropagation();
  const source = draggedEmployee;
  const rect = event.currentTarget.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  window.endEmployeeDrag();
  if (!source || source.month !== getDocId() || String(source.id) === String(target)) return;
  return saveEmployeeOrder(source.id, target, after, source.month);
};
window.changeMonth = dir => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + dir, 1);
  activeColDay = null; activeRowEmpId = null; initialScrollDone = false;
  document.querySelector('.table-wrapper').scrollLeft = 0;
  loadData();
};
window.closeModal = id => { hide(id); if (id === 'daySettingsModal') currentSettingsDay = null; if (id === 'receiptModal') currentReceiptDay = null; };
window.toggleRowHighlight = id => { activeRowEmpId = activeRowEmpId === id ? null : id; render(); };
window.toggleColHighlight = day => { activeColDay = activeColDay === day ? null : day; render(); };
window.showEmployeeInfo = (event, id) => {
  event?.stopPropagation(); const emp = findEmployee(id); if (!emp) return;
  currentEditEmpId = emp.id; window.toggleRowHighlight(emp.id);
  $('infoModalName').textContent = emp.name;
  $('statFirstHalf').textContent = shiftCount(emp, 1, 15);
  const end = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0).getDate();
  $('statSecondLabel').innerHTML = `Зміни (16-${end}): <strong id="statSecondHalf">${shiftCount(emp,16,end)}</strong>`;
  show('infoModal');
};
// The original pencil referenced an undefined editEmployee function.
window.editEmployee = (event, id) => window.showEmployeeInfo(event, id);

window.toggleRedDotMode = () => {
  if (!canEditWorker()) { openAccount(); return toast('Увійдіть і підтвердьте пошту, щоб редагувати вихідні.', 'error'); }
  if (!boundEmployeeId || !employees.some(employee => String(employee.id) === String(boundEmployeeId))) return toast('Адміністратор має прив’язати ваш обліковий запис до рядка працівника.', 'error');
  isRedDotMode = !isRedDotMode;
  $('redDotToggleBtn').className = 'mode-btn ' + (isRedDotMode ? 'on' : 'off');
  $('redDotToggleBtn').textContent = isRedDotMode ? '❌ Вийти з режиму редагування' : '🔴 Поставити вихідний';
};
window.cancelRedDot = () => { hide('confirmModal'); pendingAction = null; };
window.executeRedDot = action(async () => {
  if (!pendingAction) return;
  if (!canEditWorker()) throw new Error('Увійдіть і підтвердьте пошту.');
  const { month, id, day, unavailable } = pendingAction;
  if (!isAdmin(currentUser()) && (!boundEmployeeId || String(id) !== String(boundEmployeeId))) throw new Error('Можна позначати вихідні лише у своєму рядку.');
  await setAvailability(month,id,day,unavailable);
  window.cancelRedDot(); toast('Вихідний збережено.');
});
window.handleCellClick = (id, day) => {
  if (!ready) return;
  const emp = findEmployee(id); if (!emp) return;
  if (admin) {
    const hasShift = emp.shifts.includes(day) || emp.shiftsFirst.includes(day) || emp.shiftsSecond.includes(day);
    currentEditEmpId = emp.id; currentEditDay = day;
    if (hasShift) show('shiftModal'); else window.setShiftType('full');
  } else if (isRedDotMode && boundEmployeeId && String(emp.id) === String(boundEmployeeId)) {
    const removing = emp.unavail.includes(day);
    pendingAction = {month:getDocId(), id:emp.id, day, unavailable:!removing};
    $('confirmTitle').textContent = removing ? 'Скасувати вихідний?' : 'Додати вихідний?';
    $('confirmText').textContent = `${removing ? 'Прибрати' : 'Поставити'} червону крапку для ${emp.name} на ${day} ${monthNames[currentDate.getMonth()].toLowerCase()}?`;
    $('confirmBtn').textContent = removing ? 'Так, прибрати' : 'Так, додати';
    $('confirmBtn').className = 'modal-btn ' + (removing ? 'btn-danger' : 'btn-confirm');
    show('confirmModal');
  } else if (isRedDotMode) {
    toast(boundEmployeeId ? 'Можна позначати вихідні лише у своєму рядку.' : 'Адміністратор ще не прив’язав ваш обліковий запис до працівника.', 'error');
  }
};
window.setShiftType = action(async type => {
  if (!admin || currentEditEmpId === null || !currentEditDay) return;
  const id = currentEditEmpId, day = currentEditDay, month = getDocId();
  await updateSchedule(month, draft => {
    const emp = draft.employees.find(e => String(e.id) === String(id));
    if (!emp) throw new Error('Працівника вже видалено.');
    for (const key of ['shifts','shiftsFirst','shiftsSecond']) emp[key] = emp[key].filter(d => d !== day);
    const field = {full:'shifts',first:'shiftsFirst',second:'shiftsSecond'}[type];
    if (field) emp[field].push(day);
  });
  recordChange(month,'shifts',day); hide('shiftModal');
});
window.addEmployee = action(async () => {
  if (!admin) return;
  const name = $('newEmpName').value.trim();
  if (!name || name.length > 80) throw new Error('Введіть ім’я до 80 символів.');
  const id = crypto.randomUUID();
  await updateSchedule(getDocId(), draft => {
    if (draft.employees.some(e => e.name.toLocaleLowerCase('uk') === name.toLocaleLowerCase('uk'))) throw new Error('Таке ім’я вже існує.');
    draft.employees.push({id,name,shifts:[],shiftsFirst:[],shiftsSecond:[],unavail:[]});
  });
  $('newEmpName').value = '';
});
window.triggerEditName = action(async () => {
  const emp = findEmployee(currentEditEmpId); if (!admin || !emp) return;
  const name = prompt(`Редагування: ${emp.name}\n\nВведіть нове ім’я:`,emp.name)?.trim();
  if (!name || name === emp.name) return;
  if (name.length > 80) throw new Error('Ім’я має містити до 80 символів.');
  const id = emp.id;
  await updateSchedule(getDocId(),draft => {
    const target = draft.employees.find(e => String(e.id) === String(id));
    if (!target) throw new Error('Працівника вже видалено.');
    if (draft.employees.some(e => String(e.id)!==String(id) && e.name.toLocaleLowerCase('uk')===name.toLocaleLowerCase('uk'))) throw new Error('Таке ім’я вже існує.');
    target.name = name;
  });
  hide('infoModal');
});
window.triggerDeleteEmp = action(async () => {
  const emp = findEmployee(currentEditEmpId);
  if (!admin || !emp || !confirm(`Видалити працівника «${emp.name}» з цього місяця?`)) return;
  const id = emp.id;
  await updateSchedule(getDocId(),draft => {draft.employees = draft.employees.filter(e => String(e.id)!==String(id));});
  hide('infoModal');
});
window.editEmployeeAccess = action(async () => {
  const id = currentEditEmpId; if (!admin || id === null) return;
  const old = await employeeAccess(id);
  const uid = prompt('Код доступу працівника (порожнє поле вимикає редагування):', old);
  if (uid === null) return;
  if (uid.trim().length > 128) throw new Error('Неправильний код доступу.');
  await bindEmployee(id,uid); toast('Доступ оновлено.');
});

window.openDaySettings = day => {
  if (!admin || !ready) return;
  currentSettingsDay = day;
  $('daySettingsTitle').textContent = `Налаштування: ${day} ${monthNames[currentDate.getMonth()].toLowerCase()}`;
  renderDaySettings(); show('daySettingsModal');
};
window.toggleColFromSettings = () => { window.toggleColHighlight(currentSettingsDay); hide('daySettingsModal'); currentSettingsDay = null; };
window.handleHeaderClick = day => {
  if (!ready) return;
  if (!banquets[day]?.active) return window.toggleColHighlight(day);
  currentReceiptDay = day;
  $('receiptDate').textContent = `${day} ${monthNames[currentDate.getMonth()].toLowerCase()} ${currentDate.getFullYear()}`;
  $('receiptModal').querySelector('h3').textContent=banquets[day].type==='cleaning'?'🧹 ГЕНЕРАЛЬНЕ ПРИБИРАННЯ':'🎉 БЕНКЕТ';
  renderWorkerReceipts(); show('receiptModal');
};
window.toggleColFromReceipt = () => { window.toggleColHighlight(currentReceiptDay); hide('receiptModal'); currentReceiptDay = null; };
function renderWorkerReceipts() {
  const b = banquets[currentReceiptDay];
  renderPhotos($('receiptImagesContainer'),getDocId(),currentReceiptDay,b,false);
}
function renderDaySettings() {
  const day = currentSettingsDay, b = banquets[day];
  const container = $('banquetContainer');
  // Static markup only; all user content goes through textContent / DOM properties.
  container.innerHTML = '<div id="legacy-receipts"></div><input type="file" id="banquetFile" accept="image/*" multiple style="display:none" onchange="handleBanquetUpload(event)">';
  const type=b?.type==='cleaning'?'cleaning':'banquet';
  if (b?.active) {
    container.insertAdjacentHTML('beforeend',`<p>${type==='cleaning'?'Генеральне прибирання заплановане.':'Бенкет заплановано.'}</p>${type==='banquet'?'<button id="banquetUploadBtn" class="modal-btn" style="background:#2ecc71;color:white;border:none;margin-bottom:5px" onclick="document.getElementById(\'banquetFile\').click()">➕ Додати ще фото чеку</button>':''}<button class="modal-btn danger" onclick="deleteBanquet()">🗑 Скасувати ${type==='cleaning'?'прибирання':'бенкет'}</button>`);
  } else {
    container.insertAdjacentHTML('beforeend','<p style="font-size:.85rem;opacity:.8">Оберіть, що запланувати на цей день.</p><button id="banquetUploadBtn" class="modal-btn" style="background:#e67e22;color:white;border:none;margin-bottom:10px" onclick="document.getElementById(\'banquetFile\').click()">📸 Завантажити чек(и) бенкету</button><button class="modal-btn" style="background:var(--primary);color:white;border:none;margin-bottom:8px" onclick="markBanquetNoPhoto()">🎉 Додати бенкет</button><button class="modal-btn" style="background:#176c7b;color:white;border:none" onclick="markCleaning()">🧹 Додати генеральне прибирання</button>');
  }
  renderPhotos($('legacy-receipts'),getDocId(),day,b?.type==='cleaning'?null:b,true);
}
function renderPhotos(container,month,day,banquet,editable) {
  const ticket = {}; container.ticket = ticket; container.replaceChildren();
  const ids = banquet?.receiptIds || [];
  if (!ids.length && !(banquet?.links || []).length) {
    container.textContent = banquet?.active ? 'Бенкет активний (фото чеків немає).' : '';
    return;
  }
  ids.forEach((id,index) => {
    const card = document.createElement('div'); card.style.cssText='position:relative;padding:10px;margin-bottom:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-body)';
    card.textContent = 'Завантаження фото…'; container.append(card);
    readReceipt(month,id).then(source => {
      if (!container.isConnected || container.ticket !== ticket) return;
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(source)) throw new Error('Неправильний формат фото.');
      const img = new Image(); img.src=source; img.alt=`Чек ${index+1}`; img.className='receipt-photo'+(editable?'':' receipt-full');
      img.onclick = () => img.classList.toggle('receipt-full'); card.replaceChildren(img);
      if (editable) {
        const button=document.createElement('button'); button.textContent='X';button.setAttribute('aria-label','Видалити фото');button.style.cssText='position:absolute;top:5px;right:5px;background:#e74c3c;color:white;border:none;border-radius:50%;width:30px;height:30px;font-weight:bold;cursor:pointer';
        button.onclick=action(async()=>{if(confirm('Видалити це фото?')){await deleteReceipt(month,day,id);recordChange(month,'banquets',day)}});card.append(button);
      }
    }).catch(()=>{ if(container.ticket===ticket && container.isConnected) {card.textContent='Фото недоступне. ';const retry=document.createElement('button');retry.textContent='Повторити';retry.onclick=()=>renderPhotos(container,month,day,banquet,editable);card.append(retry);} });
  });
  for (const url of banquet?.links || []) {
    if (!/^https:\/\//.test(url)) continue;
    const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Відкрити чек ↗';link.className='modal-btn';container.append(link);
  }
}
window.markBanquetNoPhoto = action(async () => {
  const month=getDocId(),day=currentSettingsDay;if(!admin || !day)return;
  await updateSchedule(month,draft=>{draft.banquets[day]={...(draft.banquets[day]||{}),active:true,type:'banquet'};});
  recordChange(month,'banquets',day,'banquet');
});
window.markCleaning = action(async () => {
  const month=getDocId(),day=currentSettingsDay;if(!admin||!day)return;
  await updateSchedule(month,draft=>{draft.banquets[day]={active:true,type:'cleaning',note:'',links:[],receiptIds:[],time:'',guests:null};});
  recordChange(month,'banquets',day,'cleaning');toast('Генеральне прибирання додано.');
});
window.deleteBanquet = action(async () => {
  const month=getDocId(),day=currentSettingsDay;
  if (!admin || !day || !confirm(`Скасувати ${banquets[day]?.type==='cleaning'?'генеральне прибирання':'бенкет'} повністю?`)) return;
  const oldType=banquets[day]?.type==='cleaning'?'cleaning':'banquet';await removeBanquet(month,day);recordChange(month,'banquets',day,oldType);
});
window.handleBanquetUpload = action(async event => {
  const files=[...event.target.files],month=getDocId(),day=currentSettingsDay;
  if (!admin || !day || !files.length)return;
  if (files.length+(banquets[day]?.receiptIds?.length||0)>8) throw new Error('До одного бенкету можна додати не більше 8 фото.');
  let saved=0;
  try {
    // Compress before creating a banquet: an invalid first file must not create an empty event.
    for (const file of files) {
      const image=await compressReceipt(file);
      if (!saved && !banquets[day]?.active) await updateSchedule(month,draft=>{draft.banquets[day]={...(draft.banquets[day]||{}),active:true};});
      await addReceipt(month,day,image);saved++;recordChange(month,'banquets',day);
    }
    toast(`Збережено фото: ${saved}.`);
  } catch(error) {throw new Error(`Збережено фото: ${saved}. ${error.message || 'Помилка завантаження.'}`);}
  finally {event.target.value='';}
});
const noticeTitles={'schedule-added':'Графік додано',schedule:'Графік змінено',banquet:'Додано Бенкет',cleaning:'Додано генеральне прибирання','cancel-banquet':'Бенкет скасовано','cancel-cleaning':'Генеральне прибирання скасовано'};
function noticeText(n) {
 const date=n.kind==='schedule-added'?`${monthNames[currentDate.getMonth()].toLowerCase()} ${String(n.day).padStart(2,'0')}-${String(n.endDay).padStart(2,'0')}`:`${String(n.day).padStart(2,'0')}.${String(currentDate.getMonth()+1).padStart(2,'0')}`;
 return `${noticeTitles[n.kind]} ${n.kind==='schedule-added'?'на ':''}${date}.`;
}
function openNoticeEditor(notices,month,fromJournal=false) {
 const modal=$('notice-editor-modal'),list=$('notice-editor-list'),send=$('notice-editor-send');
 const selected=notices.map((notice,i)=>({...notice,selectionId:i}));
 function redraw(){
   list.replaceChildren();
   for(const item of selected){
     const row=document.createElement('div');row.className='notice-editor-item';
     const label=document.createElement('span');label.textContent=noticeText(item);
     const remove=document.createElement('button');remove.type='button';remove.textContent='✕';remove.setAttribute('aria-label','Прибрати: '+noticeText(item));
     remove.addEventListener('click',()=>{const i=selected.indexOf(item);if(i!==-1)selected.splice(i,1);redraw();});
     row.append(label,remove);list.append(row);
   }
   send.disabled=!selected.length;
   $('notice-editor-count').textContent=selected.length?`Пунктів: ${selected.length}. Одне push-повідомлення.`:'Немає вибраних змін.';
 }
 redraw();modal.hidden=false;
 $('notice-editor-cancel').onclick=()=>{modal.hidden=true;};
 send.onclick=action(async()=>{
   if(!selected.length)return;
   const chosen=selected.map(({selectionId,...item})=>item);
   const summary=await notifySchedule(month,chosen);
   modal.hidden=true;
   if(fromJournal && /^Передано службі сповіщень: [1-9]\\d*\\. Помилок: 0\\./.test(summary)){
     clearChangeJournal(month);
   }
   toast(summary);
 });
}
window.notifyNewSchedule = action(async half => {
  if(!admin || !isAdmin(currentUser()))return;
  const month=getDocId(),day=half===1?1:16,endDay=half===1?15:new Date(currentDate.getFullYear(),currentDate.getMonth()+1,0).getDate();
  openNoticeEditor([{kind:'schedule-added',day,endDay}],month);
});
window.notifyTeam = action(async () => {
  if (!allowed || !isAdmin(currentUser())) return;
  const journal=changeJournal(getDocId()),notices=[];
  for(const day of journal.shifts)notices.push({kind:'schedule',day:Number(day)});
  for(const [day,oldType] of journal.banquets){const event=banquets[day];notices.push({kind:event?.active?(event.type==='cleaning'?'cleaning':'banquet'):(oldType==='cleaning'?'cancel-cleaning':'cancel-banquet'),day:Number(day)});}
  const unique=[...new Map(notices.map(item=>[`${item.kind}:${item.day}`,item])).values()].sort((a,b)=>a.day-b.day);
  if(!unique.length)return toast('Немає нових змін для сповіщення.','error');
  openNoticeEditor(unique,getDocId(),true);
});
window.exportViewerSchedule = action(async half => {
  if(!viewerMode)return;
  await exportPNG(currentDate,{employees,banquets},half);
});
window.exportHalfMonth = action(async (event,half) => {
  await exportPNG(currentDate,{employees,banquets},half,{container:$('resultImageContainer'),modal:$('resultModal')});
});
$('retry-load').addEventListener('click',()=>{ if(allowed)loadData();else startWorker(); });
initPush();
if (admin) {
  initOwnerPanel(); installOwnerSelfBinding();
  let stopOwnerBinding=null;
  watchAuth(user=>{
    stopOwnerBinding?.();stopOwnerBinding=null;
    if(isOwner(user))stopOwnerBinding=watchTeamAccess(user,(linked,id)=>{
      boundEmployeeId=linked?id:null;
      if(linked && $('owner-self-select') && [...$('owner-self-select').options].some(option=>option.value===String(id))) $('owner-self-select').value=String(id);
    });
  });
  $('newEmpName').maxLength=80;
  $('newEmpName').addEventListener('keydown',event=>{if(event.key==='Enter')window.addEmployee();});
  $('login-form').addEventListener('submit',async event=>{
    event.preventDefault();$('login-submit').disabled=true;$('login-error').textContent='';
    try{const user=await login($('login-email').value,$('login-password').value);if(!isAdmin(user)){await logout();throw new Error('Цей обліковий запис не має прав адміністратора.');}}
    catch(error){$('login-error').textContent=error.code?'Не вдалося увійти. Перевірте пошту, пароль і з’єднання.':error.message;}
    finally{$('login-submit').disabled=false;$('login-password').value='';}
  });
  $('logout').addEventListener('click',()=>{window.location.assign(new URL('index.html',location.href).href);});
  watchAuth(user=>{renderRoleBadge(user);allowed=isAdmin(user);setPushAccess(allowed);unsubscribe?.();generation++;closeAll();employees=[];banquets={};ready=false;$('admin-panel').hidden=!allowed;$('login-panel').hidden=allowed;if(!allowed)clearPrivateContent();if(allowed){loadData();syncTeamAccess().catch(()=>toast('Для доступу працівників опублікуйте нові Rules та перезавантажте адмінку.','error'));}});
} else {
  initAccount();
  $('copy-access').addEventListener('click',async()=>{
    if (!canEditWorker()) return openAccount();
    const user=currentUser();
    try { await navigator.clipboard.writeText(user.uid); toast('Код скопійовано. Передайте адміністратору.'); }
    catch { prompt('Скопіюйте код і передайте адміністратору:',user.uid); }
  });
  watchAuth(user=>{
    renderRoleBadge(user);
    stopTeamAccess?.();stopViewerAccess?.();viewerMode=false;const ticket=++accessGeneration;
    const applyAccess = (access, employeeId = null) => {
      if(ticket!==accessGeneration)return;
      unsubscribe?.();generation++;closeAll();ready=false;allowed=access;
      boundEmployeeId=access?employeeId:null;
      employees=[];banquets={};isRedDotMode=false;
      $('redDotToggleBtn').className='mode-btn off';
      $('redDotToggleBtn').textContent='🔴 Поставити вихідний';
      $('private-schedule').hidden=!access;
      $('viewer-export').hidden=!access || !viewerMode;
      $('redDotToggleBtn').hidden=viewerMode;
      $('personal-tab').hidden=viewerMode;
      if(viewerMode)window.showScheduleView();
      document.querySelectorAll('[data-schedule-only]').forEach(node=>node.hidden=!access);
      setScheduleAccess(access);
      setPushAccess(access);
      if(access)loadData();else clearPrivateContent();
    };
    applyAccess(false);
    if(isAdmin(user)) {
      applyAccess(true);
      stopTeamAccess=watchTeamAccess(user,(linked,id)=>{
        if(ticket!==accessGeneration)return;
        boundEmployeeId=linked?id:null;
        if($('personal-view')&&!$('personal-view').hidden)renderPersonalDashboard();
      });
    } else {
      stopTeamAccess=watchTeamAccess(user,(linked,id)=>{if(ticket!==accessGeneration)return;if(linked){viewerMode=false;applyAccess(true,id);}else if(!viewerMode)applyAccess(false);});
      stopViewerAccess=watchViewerAccess(user,enabled=>{if(ticket!==accessGeneration)return;viewerMode=enabled;if(enabled)applyAccess(true,null);else if(!boundEmployeeId)applyAccess(false);});
    }
  });
}
async function startWorker(){render();try{await ensureWorkerSession();}catch(error){loadError=true;render();status('Не вдалося підключитися. Перевірте інтернет.',true);}}
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeAll();});
    function renderIndex() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const head = document.getElementById('header-row');
        const body = document.getElementById('body-row');
        
        let headHtml = '<th>Ім\'я</th>';
        for(let i=1; i<=daysInMonth; i++) {
            const dayIndex = new Date(year, month, i).getDay();
            const isWeekend = (dayIndex === 0 || dayIndex === 6);
            const isToday = (year === todayDate.getFullYear() && month === todayDate.getMonth() && i === todayDate.getDate());
            const dayEvent = banquets[i]?.active ? banquets[i] : null;
            const isBanquet = !!dayEvent;
            const duty = getDutyName(year, month, i);
            
            let thClass = isWeekend ? 'weekend' : '';
            if (isToday) thClass += ' current-day-th';
            if (isBanquet) thClass += ' event-day-th';
            if (isBanquet) thClass += dayEvent.type==='cleaning' ? ' cleaning-th' : ' banquet-th';
            else if (activeColDay === i) thClass += ' highlight-col';
            
            let banquetLabel = isBanquet ? `<span class="${dayEvent.type==='cleaning'?'cleaning-label':'banquet-label'}">${dayEvent.type==='cleaning'?'🧹 ГЕНПРИБ.':'🎉 БЕНКЕТ'}</span>` : '';

            headHtml += `<th data-day="${i}" class="${thClass}" style="line-height: 1.1; min-width: 50px; cursor: pointer;" onclick="handleHeaderClick(${i})">
                <span class="day-number">${i}</span><br>
                <span style="font-size: 0.65rem; font-weight: normal; opacity: 0.85;">${dayNames[dayIndex]}</span>
                <span class="duty-text" style="${isBanquet ? 'color: white;' : ''}">${duty}</span>
                ${banquetLabel}
            </th>`;
        }
        head.innerHTML = headHtml;

        if (employees.length === 0) {
            body.innerHTML = `<tr><td colspan="${daysInMonth + 1}" style="padding: 30px; text-align: center; color: #888; font-weight: bold;">${emptyMessage()}</td></tr>`;
            return;
        }

        body.innerHTML = employees.map((emp, index) => {
            const isLastRow = (index === employees.length - 1);
            const isRowHighlighted = (activeRowEmpId === emp.id);
            const worksOnActiveDay = activeColDay && (emp.shifts.includes(activeColDay) || emp.shiftsFirst.includes(activeColDay) || emp.shiftsSecond.includes(activeColDay));
            
            return `<tr class="${isRowHighlighted ? 'highlight-row' : ''}">
                <td onclick="showEmployeeInfo(event, ${safeId(emp.id)})" class="${worksOnActiveDay ? 'highlight-name' : ''}">${escapeHTML(emp.name)}</td>
                ${Array.from({length:daysInMonth}, (_, i) => {
                    const day = i + 1;
                    const isWeekend = (new Date(year, month, day).getDay() % 6 === 0);
                    const isToday = (year === todayDate.getFullYear() && month === todayDate.getMonth() && day === todayDate.getDate());
                    const isBanquet = (banquets[day] && banquets[day].active);
                    
                    let tdClass = isWeekend ? 'weekend' : '';
                    if (isToday) tdClass += ' current-day-td';
                    if (isToday && isLastRow) tdClass += ' current-day-td-bottom';
                    if (isBanquet) tdClass += banquets[day].type==='cleaning' ? ' cleaning-td' : ' banquet-td';
                    else if (activeColDay === day) tdClass += ' highlight-col';

                    let content = '';
                    if(emp.shifts.includes(day)) content = '<span class="shift-icon shift-full"></span>';
                    else if(emp.shiftsFirst.includes(day)) content = '<span class="shift-icon shift-first"></span>';
                    else if(emp.shiftsSecond.includes(day)) content = '<span class="shift-icon shift-second"></span>';
                    if(emp.unavail.includes(day)) content += '<span class="unavailable">•</span>';
                    
                    return `<td data-day="${day}" class="${tdClass}" onclick="handleCellClick(${safeId(emp.id)}, ${day})">${content}</td>`;
                }).join('')}
            </tr>`;
        }).join('');

        if (!initialScrollDone && year === todayDate.getFullYear() && month === todayDate.getMonth()) {
            setTimeout(() => {
                const todayTh = document.querySelector('.current-day-th');
                if (todayTh) todayTh.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                initialScrollDone = true;
            }, 300);
        }
    }

    function renderAdmin() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const head = document.getElementById('h-row');
        const body = document.getElementById('b-row');
        
        let headHtml = '<th>Працівник</th>';
        for(let i=1; i<=daysInMonth; i++) {
            const dayIndex = new Date(year, month, i).getDay();
            const isWeekend = (dayIndex === 0 || dayIndex === 6);
            const isToday = (year === todayDate.getFullYear() && month === todayDate.getMonth() && i === todayDate.getDate());
            const dayEvent = banquets[i]?.active ? banquets[i] : null;
            const isBanquet = !!dayEvent;
            const duty = getDutyName(year, month, i);
            
            let thClass = isWeekend ? 'weekend' : '';
            if (isToday) thClass += ' current-day-th';
            if (isBanquet) thClass += ' event-day-th';
            if (isBanquet) thClass += dayEvent.type==='cleaning' ? ' cleaning-th' : ' banquet-th';
            else if (activeColDay === i) thClass += ' highlight-col';
            
            let banquetLabel = isBanquet ? `<span class="${dayEvent.type==='cleaning'?'cleaning-label':'banquet-label'}">${dayEvent.type==='cleaning'?'🧹 ГЕНПРИБ.':'🎉 БЕНКЕТ'}</span>` : '';

        headHtml += `<th data-day="${i}" class="${thClass}" style="line-height: 1.1; min-width: 50px; cursor: pointer;" onclick="openDaySettings(${i})">
                <span class="day-number">${i}</span><br>
                <span style="font-size: 0.65rem; font-weight: normal; opacity: 0.85;">${dayNames[dayIndex]}</span>
                <span class="duty-text" style="${isBanquet ? 'color: white;' : ''}">${duty}</span>
                ${banquetLabel}
            </th>`;
        }
        head.innerHTML = headHtml;

        if (employees.length === 0) {
            body.innerHTML = `<tr><td colspan="${daysInMonth + 1}" style="padding: 30px; text-align: center; color: #888; font-weight: bold;">${emptyMessage()}</td></tr>`;
            return;
        }

        body.innerHTML = employees.map((emp, index) => {
            const isLastRow = (index === employees.length - 1);
            const isRowHighlighted = (activeRowEmpId === emp.id);
            const worksOnActiveDay = activeColDay && (emp.shifts.includes(activeColDay) || emp.shiftsFirst.includes(activeColDay) || emp.shiftsSecond.includes(activeColDay));
            
            return `<tr ondragover="overEmployeeRow(event)" ondragleave="leaveEmployeeRow(event)" ondrop="dropEmployeeRow(event, ${safeId(emp.id)})" class="${isRowHighlighted ? 'highlight-row' : ''}">
                <td onclick="showEmployeeInfo(event, ${safeId(emp.id)})" class="${worksOnActiveDay ? 'highlight-name' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>${escapeHTML(emp.name)}</span>
                        <span class="row-order-controls" onclick="event.stopPropagation()">
                            <button class="row-drag" draggable="true" ondragstart="startEmployeeDrag(event, ${safeId(emp.id)})" ondragend="endEmployeeDrag()" title="Перетягніть рядок або скористайтеся стрілками" aria-label="Перетягнути рядок ${escapeHTML(emp.name)}">⠿</button>
                            <button onclick="moveEmployeeRow(event, ${safeId(emp.id)}, -1)" ${index === 0 ? 'disabled' : ''} aria-label="Перемістити ${escapeHTML(emp.name)} вгору">↑</button>
                            <button onclick="moveEmployeeRow(event, ${safeId(emp.id)}, 1)" ${isLastRow ? 'disabled' : ''} aria-label="Перемістити ${escapeHTML(emp.name)} вниз">↓</button>
                        </span>
                        <button class="edit-btn" onclick="editEmployee(event, ${safeId(emp.id)})">✏️</button>
                    </div>
                </td>
                ${Array.from({length:daysInMonth}, (_, i) => {
                    const day = i + 1;
                    const isWeekend = (new Date(year, month, day).getDay() % 6 === 0);
                    const isToday = (year === todayDate.getFullYear() && month === todayDate.getMonth() && day === todayDate.getDate());
                    const isBanquet = (banquets[day] && banquets[day].active);
                    
                    let tdClass = isWeekend ? 'weekend' : '';
                    if (isToday) tdClass += ' current-day-td';
                    if (isToday && isLastRow) tdClass += ' current-day-td-bottom';
                    if (isBanquet) tdClass += banquets[day].type==='cleaning' ? ' cleaning-td' : ' banquet-td';
                    else if (activeColDay === day) tdClass += ' highlight-col';

                    let content = '';
                    if(emp.shifts.includes(day)) content = '<span class="shift-icon shift-full"></span>';
                    else if(emp.shiftsFirst.includes(day)) content = '<span class="shift-icon shift-first"></span>';
                    else if(emp.shiftsSecond.includes(day)) content = '<span class="shift-icon shift-second"></span>';
                    if(emp.unavail.includes(day)) content += '<span class="unavail-marker">•</span>';
                    
                    return `<td data-day="${day}" class="${tdClass}" onclick="handleCellClick(${safeId(emp.id)}, ${day})">${content}</td>`;
                }).join('')}
            </tr>`;
        }).join('');

        if (!initialScrollDone && year === todayDate.getFullYear() && month === todayDate.getMonth()) {
            setTimeout(() => {
                const todayTh = document.querySelector('.current-day-th');
                if (todayTh) todayTh.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                initialScrollDone = true;
            }, 300);
        }
    }
