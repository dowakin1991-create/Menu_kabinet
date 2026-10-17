import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  collection, getDocs,
  getDoc,
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js?v=20261015.2";

export const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const validDay = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 31;
const days = value => [...new Set(Array.isArray(value) ? value.map(Number).filter(validDay) : [])].sort((a, b) => a - b);

function safeText(value, fallback = "") {
  return typeof value === "string" ? value.slice(0, 500) : fallback;
}

function normalizeEmployee(employee, index) {
  const full = days(employee?.shifts);
  const first = days(employee?.shiftsFirst).filter(day => !full.includes(day));
  const second = days(employee?.shiftsSecond).filter(day => !full.includes(day) && !first.includes(day));
  return {
    id: employee?.id ?? `legacy-${index}`,
    name: safeText(employee?.name, "Без імені").trim() || "Без імені",
    shifts: full,
    shiftsFirst: first,
    shiftsSecond: second,
    unavail: days(employee?.unavail)
  };
}

function normalizeBanquet(value) {
  if (typeof value === "string") return { active: true, links: [value], note: "", time: "", guests: null };
  const links = Array.isArray(value?.links)
    ? value.links.filter(link => typeof link === "string" && /^https:\/\//.test(link)).slice(0, 8)
    : [];
  const guests = Number(value?.guests);
  return {
    active: value?.active !== false,
    type: value?.type === "cleaning" ? "cleaning" : "banquet",
    links,
    receiptIds: Array.isArray(value?.receiptIds) ? value.receiptIds.filter(id => /^[a-f0-9-]{36}$/.test(id)).slice(0, 8) : [],
    note: safeText(value?.note).trim(),
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(value?.time || "") ? value.time : "",
    guests: Number.isInteger(guests) && guests > 0 && guests < 1000 ? guests : null
  };
}

export function normalizeSchedule(raw = {}) {
  const banquets = {};
  if (raw.banquets && typeof raw.banquets === "object") {
    for (const [day, value] of Object.entries(raw.banquets)) {
      if (validDay(day)) banquets[String(Number(day))] = normalizeBanquet(value);
    }
  }
  return {
    employees: Array.isArray(raw.employees) ? raw.employees.map(normalizeEmployee) : [],
    banquets
  };
}

export function monthId(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function subscribeSchedule(id, onData, onError) {
  let schedule = normalizeSchedule();
  let scheduleReady = false, availabilityReady = false, stopped = false, failed = false;
  const fail = error => { failed = true; onError(error); };
  const availability = new Map();
  const emit = () => { if (stopped || failed || !scheduleReady || !availabilityReady) return; onData({
    ...schedule,
    employees: schedule.employees.map(employee => ({
      ...employee,
      unavail: availability.has(String(employee.id)) ? availability.get(String(employee.id)) : employee.unavail
    }))
  }); };
  const stopSchedule = onSnapshot(doc(db, "schedules", id), snapshot => {
    schedule = normalizeSchedule(snapshot.exists() ? snapshot.data() : {});
    scheduleReady = true;
    emit();
  }, fail);
  const stopAvailability = onSnapshot(collection(db, "availability", id, "employees"), snapshot => {
    availabilityReady = true;
    availability.clear();
    snapshot.forEach(item => availability.set(item.id, days(item.data()?.days)));
    emit();
  }, fail);
  return () => { stopped = true; stopSchedule(); stopAvailability(); };
}

export async function updateSchedule(id, mutate) {
  const reference = doc(db, "schedules", id);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const draft = normalizeSchedule(snapshot.exists() ? snapshot.data() : {});
    await mutate(draft);
    transaction.set(reference, {
      employees: draft.employees,
      banquets: draft.banquets,
      schemaVersion: 2,
      updatedAt: serverTimestamp()
    });
  });
}

export async function setAvailability(id, employeeId, day, unavailable) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(id)) throw new Error("Неправильний місяць.");
  const [year, month] = id.split("-").map(Number);
  if (!Number.isInteger(day) || day < 1 || day > new Date(year, month, 0).getDate()) throw new Error("Неправильний день.");
  const reference = doc(db, "availability", id, "employees", String(employeeId));
  await runTransaction(db, async tx => {
    const snapshot = await tx.get(reference);
    const schedule = await tx.get(doc(db, "schedules", id));
    const employee = normalizeSchedule(schedule.data()).employees.find(e => String(e.id) === String(employeeId));
    if (!employee) throw new Error("Працівника вже видалено.");
    const selected = new Set(snapshot.exists() ? days(snapshot.data().days) : employee.unavail);
    if (unavailable) selected.add(day); else selected.delete(day);
    tx.set(reference, { days: [...selected].sort((a, b) => a - b), updatedAt: serverTimestamp() });
  });
}

// Name and access must either both be saved or neither.
export async function saveEmployeeProfile(month, id, name, uid) {
  name = name.trim(); uid = uid.trim();
  if (!name || name.length > 80 || uid.length > 128) throw new Error("Перевірте ім’я та код доступу.");
  const reference = doc(db, "schedules", month);
  await runTransaction(db, async tx => {
    const snap = await tx.get(reference);
    const data = normalizeSchedule(snap.data());
    const employee = data.employees.find(e => String(e.id) === String(id));
    if (!employee) throw new Error("Працівника вже видалено.");
    if (data.employees.some(e => String(e.id) !== String(id) && e.name.toLocaleLowerCase("uk") === name.toLocaleLowerCase("uk"))) throw new Error("Таке ім’я вже існує.");
    employee.name = name;
    tx.update(reference, { employees: data.employees, updatedAt: serverTimestamp() });
    tx.set(doc(db, "employeeAccess", String(id)), { uid });
    if (uid) tx.set(doc(db,"teamAccess",uid),{employeeId:String(id)});
  });
}

export async function bindEmployee(employeeId, uid) {
  uid=uid.trim();
  if (uid.length>128 || uid.includes('/')) throw new Error('Неправильний код доступу.');
  await runTransaction(db,async tx=>{
    tx.set(doc(db,'employeeAccess',String(employeeId)),{uid});
    if(uid) tx.set(doc(db,'teamAccess',uid),{employeeId:String(employeeId)});
  });
}

export async function bindOwnerEmployee(employeeIds, targetId, ownerUid) {
  const ids=[...new Set(employeeIds.map(String))], chosen=String(targetId);
  if(!ids.includes(chosen)||!ownerUid)throw new Error('Оберіть ім’я з графіка.');
  await runTransaction(db,async tx=>{
    const refs=ids.map(id=>doc(db,'employeeAccess',id));
    const snaps=[];
    for(const ref of refs)snaps.push(await tx.get(ref));
    const targetIndex=ids.indexOf(chosen);
    const occupied=snaps[targetIndex].exists()?snaps[targetIndex].data().uid:'';
    if(occupied&&occupied!==ownerUid)throw new Error('Це ім’я вже прив’язане до іншого акаунта.');
    const teamRef=doc(db,'teamAccess',ownerUid);
    const teamSnap=await tx.get(teamRef);
    const oldId=teamSnap.exists()?String(teamSnap.data().employeeId||''):'';
    if(oldId&&!ids.includes(oldId)&&oldId!==chosen){
      const oldRef=doc(db,'employeeAccess',oldId);
      const oldSnap=await tx.get(oldRef);
      if(oldSnap.exists()&&oldSnap.data().uid===ownerUid)tx.set(oldRef,{uid:''});
    }
    for(let i=0;i<ids.length;i++){
      if(ids[i]!==chosen&&snaps[i].exists()&&snaps[i].data().uid===ownerUid)tx.set(refs[i],{uid:''});
    }
    tx.set(refs[targetIndex],{uid:ownerUid});
    tx.set(teamRef,{employeeId:chosen});
  });
}

export async function employeeAccess(employeeId) {
  const snap = await getDoc(doc(db, "employeeAccess", String(employeeId)));
  return snap.exists() ? snap.data().uid : "";
}

export async function readReceipt(month, id) {
  const snapshot = await getDoc(doc(db, "schedules", month, "receipts", id));
  if (!snapshot.exists()) throw new Error("Фото не знайдено.");
  return snapshot.data().image;
}

export async function addReceipt(month, day, image) {
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 700000) {
    throw new Error("Фото завелике або має неправильний формат.");
  }
  const id = crypto.randomUUID();
  const scheduleRef = doc(db, "schedules", month);
  await runTransaction(db, async tx => {
    const snap = await tx.get(scheduleRef);
    const data = normalizeSchedule(snap.data());
    const banquet = data.banquets[String(day)];
    if (!banquet?.active) throw new Error("Спершу збережіть бенкет.");
    if ((banquet.receiptIds || []).length >= 8) throw new Error("У бенкеті вже є 8 фото.");
    banquet.receiptIds = [...(banquet.receiptIds || []), id];
    tx.set(doc(db, "schedules", month, "receipts", id), { image, createdAt: serverTimestamp() });
    tx.update(scheduleRef, { banquets: data.banquets, updatedAt: serverTimestamp() });
  });
}

export async function deleteReceipt(month, day, id) {
  const reference = doc(db, "schedules", month);
  await runTransaction(db, async tx => {
    const snap = await tx.get(reference);
    const data = normalizeSchedule(snap.data());
    const banquet = data.banquets[String(day)];
    if (!banquet) throw new Error("Бенкет уже видалено.");
    banquet.receiptIds = (banquet.receiptIds || []).filter(value => value !== id);
    tx.update(reference, { banquets: data.banquets, updatedAt: serverTimestamp() });
    tx.delete(doc(db, "schedules", month, "receipts", id));
  });
}

export async function removeBanquet(month, day) {
  const reference = doc(db, "schedules", month);
  await runTransaction(db, async tx => {
    const snap = await tx.get(reference);
    const data = normalizeSchedule(snap.data());
    for (const id of data.banquets[String(day)]?.receiptIds || []) {
      tx.delete(doc(db, "schedules", month, "receipts", id));
    }
    delete data.banquets[String(day)];
    tx.update(reference, { banquets: data.banquets, updatedAt: serverTimestamp() });
  });
}


// Move only the selected employee in the latest transactional snapshot.
export async function moveEmployee(month, employeeId, targetId, after = false) {
  if (String(employeeId) === String(targetId)) return;
  await updateSchedule(month, draft => {
    const from = draft.employees.findIndex(e => String(e.id) === String(employeeId));
    const target = draft.employees.findIndex(e => String(e.id) === String(targetId));
    if (from < 0 || target < 0) throw new Error('Список працівників змінився. Повторіть переміщення.');
    const [employee] = draft.employees.splice(from, 1);
    const to = draft.employees.findIndex(e => String(e.id) === String(targetId));
    draft.employees.splice(to + (after ? 1 : 0), 0, employee);
  });
}

// Seed an unopened month from the most recent earlier roster, never overwrite it.
export async function ensureMonthRoster(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Некоректний місяць.');
  const target = doc(db, 'schedules', month);
  if ((await getDoc(target)).exists()) return false;
  const schedules = await getDocs(collection(db, 'schedules'));
  const source = schedules.docs
    .filter(item => /^\d{4}-(0[1-9]|1[0-2])$/.test(item.id) && item.id < month)
    .sort((a, b) => b.id.localeCompare(a.id))[0]?.ref;
  if (!source) return false;
  return runTransaction(db, async tx => {
    const current = await tx.get(target);
    if (current.exists()) return false;
    const prior = await tx.get(source);
    if (!prior.exists()) return false;
    const roster = normalizeSchedule(prior.data()).employees;
    if (!roster.length) return false;
    tx.set(target, {
      employees: roster.map(({id, name}) => ({id, name, shifts:[], shiftsFirst:[], shiftsSecond:[], unavail:[]})),
      banquets: {}, schemaVersion: 2, updatedAt: serverTimestamp()
    });
    return true;
  });
}
