import { isAdmin, login, logout, watchAuth } from "./auth.js";
import { bindEmployee, employeeAccess, monthId, subscribeSchedule, updateSchedule } from "./store.js";
import {
  bindModalDismissals,
  closeModal,
  daysInMonth,
  monthLabel,
  qs,
  renderSchedule,
  scrollToToday,
  setConnection,
  shareOrCopy,
  shiftCount,
  showModal,
  toast
} from "./ui.js";

const state = {
  date: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  data: { employees: [], banquets: {} },
  unsubscribe: null,
  employeeId: null,
  shift: null,
  banquetDay: null,
  highlightedDay: null,
  changedShiftDays: new Set(),
  changedBanquetDays: new Set()
};

const sameId = (a, b) => String(a) === String(b);

function render() {
  qs("#month-title").textContent = monthLabel(state.date);
  renderSchedule({
    table: qs("#schedule"),
    date: state.date,
    data: state.data,
    highlightedDay: state.highlightedDay,
    editableEmployeeId: "*",
    onEmployee: openEmployee,
    onDay: openDay,
    onCell: openShift
  });
}

function subscribe() {
  state.unsubscribe?.();
  state.changedShiftDays.clear();
  state.changedBanquetDays.clear();
  setConnection("", "Підключення…");
  state.unsubscribe = subscribeSchedule(
    monthId(state.date),
    data => {
      state.data = data;
      setConnection("online", "Дані актуальні");
      render();
      if (state.date.getFullYear() === new Date().getFullYear() && state.date.getMonth() === new Date().getMonth()) scrollToToday();
    },
    error => {
      console.error(error);
      setConnection("error", "Немає доступу");
      toast("Firebase відхилив доступ до графіка.", "error");
    }
  );
}

function changeMonth(offset) {
  state.date = new Date(state.date.getFullYear(), state.date.getMonth() + offset, 1);
  state.highlightedDay = null;
  qs("#table-scroll").scrollLeft = 0;
  subscribe();
}

async function openEmployee(employee) {
  state.employeeId = employee.id;
  qs("#employee-editor-title").textContent = employee.name;
  qs("#employee-name").value = employee.name;
  qs("#employee-first-half").textContent = String(shiftCount(employee, 1, 15));
  qs("#employee-second-half").textContent = String(shiftCount(employee, 16, daysInMonth(state.date)));
  qs("#employee-uid").value = "";
  try { qs("#employee-uid").value = await employeeAccess(employee.id); }
  catch { return toast("Не вдалося прочитати доступ працівника.", "error"); }
  showModal("employee-editor");
}

async function addEmployee() {
  const input = qs("#new-employee-name");
  const name = input.value.trim();
  if (!name) return toast("Введіть ім’я працівника.", "error");
  const button = qs("#confirm-add");
  button.disabled = true;
  try {
    await updateSchedule(monthId(state.date), draft => {
      if (draft.employees.some(employee => employee.name.toLocaleLowerCase("uk") === name.toLocaleLowerCase("uk"))) throw new Error("Працівник із таким ім’ям уже існує.");
      draft.employees.push({ id: Date.now(), name, shifts: [], shiftsFirst: [], shiftsSecond: [], unavail: [] });
    });
    input.value = "";
    closeModal("add-editor");
    toast("Працівника додано.");
  } catch (error) {
    console.error(error);
    toast(error.message || "Не вдалося додати працівника.", "error");
  } finally { button.disabled = false; }
}

async function saveEmployee() {
  const name = qs("#employee-name").value.trim();
  if (!name) return toast("Ім’я не може бути порожнім.", "error");
  try {
    await updateSchedule(monthId(state.date), draft => {
      const employee = draft.employees.find(item => sameId(item.id, state.employeeId));
      if (!employee) throw new Error("Працівника вже видалено.");
      employee.name = name;
    });
    await bindEmployee(state.employeeId, qs("#employee-uid").value);
    closeModal("employee-editor");
    toast("Працівника та доступ оновлено.");
  } catch (error) { console.error(error); toast(error.message || "Не вдалося зберегти.", "error"); }
}

async function deleteEmployee() {
  const employee = state.data.employees.find(item => sameId(item.id, state.employeeId));
  if (!employee || !confirm(`Видалити «${employee.name}» з графіка за ${monthLabel(state.date)}?`)) return;
  try {
    await updateSchedule(monthId(state.date), draft => { draft.employees = draft.employees.filter(item => !sameId(item.id, state.employeeId)); });
    closeModal("employee-editor");
    toast("Працівника видалено з цього місяця.");
  } catch (error) { console.error(error); toast("Не вдалося видалити працівника.", "error"); }
}

function openShift(employee, day) {
  state.shift = { employeeId: employee.id, day };
  qs("#shift-editor-title").textContent = `${employee.name} — ${day} число`;
  qs("#shift-editor-description").textContent = employee.unavail.includes(day)
    ? "Працівник позначив цей день як бажаний вихідний. Робочу зміну все одно можна встановити."
    : "Оберіть тип робочої зміни.";
  showModal("shift-editor");
}

async function setShift(type) {
  if (!state.shift) return;
  const { employeeId, day } = state.shift;
  try {
    await updateSchedule(monthId(state.date), draft => {
      const employee = draft.employees.find(item => sameId(item.id, employeeId));
      if (!employee) throw new Error("Працівника не знайдено.");
      employee.shifts = employee.shifts.filter(value => value !== day);
      employee.shiftsFirst = employee.shiftsFirst.filter(value => value !== day);
      employee.shiftsSecond = employee.shiftsSecond.filter(value => value !== day);
      if (type === "full") employee.shifts.push(day);
      if (type === "first") employee.shiftsFirst.push(day);
      if (type === "second") employee.shiftsSecond.push(day);
    });
    state.changedShiftDays.add(day);
    closeModal("shift-editor");
    toast("Зміну збережено.");
  } catch (error) { console.error(error); toast(error.message || "Не вдалося зберегти зміну.", "error"); }
}

function openDay(day) {
  state.banquetDay = day;
  state.highlightedDay = day;
  render();
  const banquet = state.data.banquets[String(day)] || { active: false, time: "", guests: null, note: "", links: [] };
  qs("#day-editor-title").textContent = `${day} ${monthLabel(state.date).split(" ")[0]} — бенкет`;
  qs("#banquet-time").value = banquet.time || "";
  qs("#banquet-guests").value = banquet.guests || "";
  qs("#banquet-note").value = banquet.note || "";
  qs("#delete-banquet").hidden = !banquet.active;
  qs("#receipt-links").value = (banquet.links || []).join("\n");
  showModal("day-editor");
}

async function saveBanquet() {
  const day = state.banquetDay;
  if (!day) return;
  const time = qs("#banquet-time").value;
  const guests = Number(qs("#banquet-guests").value);
  const note = qs("#banquet-note").value.trim();
  const links = qs("#receipt-links").value.split("\n").map(value => value.trim()).filter(value => /^https:\/\//.test(value)).slice(0, 8);
  try {
    await updateSchedule(monthId(state.date), draft => {

      draft.banquets[String(day)] = {
        active: true,
        links,
        time,
        guests: Number.isInteger(guests) && guests > 0 ? guests : null,
        note
      };
    });
    state.changedBanquetDays.add(day);
    closeModal("day-editor");
    toast("Бенкет збережено.");
  } catch (error) { console.error(error); toast("Не вдалося зберегти бенкет.", "error"); }
}

async function deleteBanquet() {
  const day = state.banquetDay;
  const banquet = state.data.banquets[String(day)];
  if (!banquet || !confirm(`Скасувати бенкет на ${day} число?`)) return;
  try {
    await updateSchedule(monthId(state.date), draft => { delete draft.banquets[String(day)]; });
    state.changedBanquetDays.add(day);
    closeModal("day-editor");
    toast("Бенкет скасовано.");
  } catch (error) { console.error(error); toast("Не вдалося скасувати бенкет.", "error"); }
}

async function prepareNotification() {
  const shifts = [...state.changedShiftDays].sort((a, b) => a - b);
  const banquets = [...state.changedBanquetDays].sort((a, b) => a - b);
  let text = `Оновлено графік KABINET за ${monthLabel(state.date)}.`;
  if (shifts.length) text += `\nЗміни в робочих днях: ${shifts.join(", ")}.`;
  if (banquets.length) text += `\nЗміни щодо бенкетів: ${banquets.join(", ")}.`;
  text += "\nПеревірте актуальний графік за посиланням:";
  try { toast(await shareOrCopy(text)); } catch (error) { console.error(error); toast("Не вдалося скопіювати повідомлення.", "error"); }
}

qs("#previous-month").addEventListener("click", () => changeMonth(-1));
qs("#next-month").addEventListener("click", () => changeMonth(1));
qs("#today").addEventListener("click", () => {
  const now = new Date();
  state.date = new Date(now.getFullYear(), now.getMonth(), 1);
  subscribe();
});
qs("#add-employee").addEventListener("click", () => showModal("add-editor"));
qs("#confirm-add").addEventListener("click", addEmployee);
qs("#new-employee-name").addEventListener("keydown", event => { if (event.key === "Enter") addEmployee(); });
qs("#save-employee").addEventListener("click", saveEmployee);
qs("#delete-employee").addEventListener("click", deleteEmployee);
document.querySelectorAll("[data-shift]").forEach(button => button.addEventListener("click", () => setShift(button.dataset.shift)));
qs("#save-banquet").addEventListener("click", saveBanquet);
qs("#delete-banquet").addEventListener("click", deleteBanquet);
qs("#notify").addEventListener("click", prepareNotification);
qs("#print").addEventListener("click", () => window.print());

qs("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  qs("#login-submit").disabled = true;
  qs("#login-error").textContent = "";
  try {
    const user = await login(qs("#login-email").value, qs("#login-password").value);
    if (!isAdmin(user)) {
      await logout();
      qs("#login-error").textContent = "Цей обліковий запис не має прав адміністратора.";
    }
  } catch (error) {
    qs("#login-error").textContent = error.code === "auth/network-request-failed"
      ? "Немає з’єднання. Перевірте інтернет."
      : "Не вдалося увійти. Перевірте пошту, пароль і налаштування Authentication.";
  } finally {
    qs("#login-password").value = "";
    qs("#login-submit").disabled = false;
  }
});
qs("#logout").addEventListener("click", () => logout().catch(() => toast("Не вдалося вийти.", "error")));
watchAuth(user => {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.data = { employees: [], banquets: {} };
  state.employeeId = null;
  state.shift = null;
  state.banquetDay = null;
  state.changedShiftDays.clear();
  state.changedBanquetDays.clear();
  document.querySelectorAll(".modal-backdrop").forEach(node => { node.hidden = true; });
  qs("#receipt-links").value = "";
  qs("#employee-name").value = "";
  qs("#banquet-note").value = "";
  render();
  const allowed = isAdmin(user);
  qs("#admin-panel").hidden = !allowed;
  qs("#login-panel").hidden = allowed;
  if (allowed) subscribe();
});
bindModalDismissals();
