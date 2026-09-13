import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  collection,
  getDoc,
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

export const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const validDay = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 31;
const days = value => [...new Set(Array.isArray(value) ? value.map(Number).filter(validDay) : [])].sort((a, b) => a - b);

function safeText(value, fallback = "") {
  return typeof value === "string" ? value.slice(0, 500) : fallback;
}

function normalizeEmployee(employee, index) {
  return {
    id: employee?.id ?? Date.now() + index,
    name: safeText(employee?.name, "Без імені").trim() || "Без імені",
    shifts: days(employee?.shifts),
    shiftsFirst: days(employee?.shiftsFirst),
    shiftsSecond: days(employee?.shiftsSecond),
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
    links,
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
  const availability = new Map();
  const emit = () => onData({
    ...schedule,
    employees: schedule.employees.map(employee => ({
      ...employee,
      unavail: availability.has(String(employee.id)) ? availability.get(String(employee.id)) : employee.unavail
    }))
  });
  const stopSchedule = onSnapshot(doc(db, "schedules", id), snapshot => {
    schedule = normalizeSchedule(snapshot.exists() ? snapshot.data() : {});
    emit();
  }, onError);
  const stopAvailability = onSnapshot(collection(db, "availability", id, "employees"), snapshot => {
    availability.clear();
    snapshot.forEach(item => availability.set(item.id, days(item.data()?.days)));
    emit();
  }, onError);
  return () => { stopSchedule(); stopAvailability(); };
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

export async function setAvailability(id, employeeId, values) {
  await setDoc(doc(db, "availability", id, "employees", String(employeeId)), {
    days: days(values),
    updatedAt: serverTimestamp()
  });
}

export async function bindEmployee(employeeId, uid) {
  await setDoc(doc(db, "employeeAccess", String(employeeId)), { uid: uid.trim() });
}
export async function employeeAccess(employeeId) {
  const snap = await getDoc(doc(db, "employeeAccess", String(employeeId)));
  return snap.exists() ? snap.data().uid : "";
}
