import { renderReceipts } from "./receipts.js?v=receipts1";
import { ensureWorkerSession } from "./auth.js?v=receipts1";
import { monthId, setAvailability, subscribeSchedule } from "./store.js?v=receipts1";
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
} from "./ui.js?v=receipts1";

const state = {
  date: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  data: { employees: [], banquets: {} },
  selectedEmployeeId: localStorage.getItem("kabinet.employee") || "",
  editing: false,
  highlightedDay: null,
  pending: null,
  unsubscribe: null
};

function currentEmployee() {
  return state.data.employees.find(employee => String(employee.id) === state.selectedEmployeeId);
}

function updateProfileSelect() {
  const select = qs("#employee-select");
  const previous = state.selectedEmployeeId;
  select.replaceChildren(new Option("Оберіть своє ім’я", ""));
  for (const employee of state.data.employees) select.add(new Option(employee.name, String(employee.id)));
  if (state.data.employees.some(employee => String(employee.id) === previous)) select.value = previous;
  else {
    state.selectedEmployeeId = "";
    localStorage.removeItem("kabinet.employee");
  }
  qs("#edit-availability").disabled = !state.selectedEmployeeId;
}

function render() {
  qs("#month-title").textContent = monthLabel(state.date);
  updateProfileSelect();
  renderSchedule({
    table: qs("#schedule"),
    date: state.date,
    data: state.data,
    selectedEmployeeId: state.selectedEmployeeId,
    highlightedDay: state.highlightedDay,
    editableEmployeeId: state.editing ? state.selectedEmployeeId : null,
    onEmployee: showEmployee,
    onDay: showBanquetOrHighlight,
    onCell: askAvailability
  });
  const button = qs("#edit-availability");
  button.textContent = state.editing ? "Завершити редагування" : "Позначити бажаний вихідний";
  button.classList.toggle("primary", state.editing);
  qs("#edit-hint").textContent = state.editing
    ? `Редагування для «${currentEmployee()?.name || ""}». Натисніть потрібний день у своєму рядку.`
    : state.selectedEmployeeId
      ? "Натисніть ім’я, щоб побачити кількість змін, або заголовок дня — щоб виділити стовпець."
      : "Оберіть своє ім’я. Після цього можна буде позначити бажані вихідні.";
}

function subscribe() {
  state.unsubscribe?.();
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
      toast("Не вдалося завантажити графік. Перевірте інтернет або правила Firebase.", "error");
    }
  );
}

function changeMonth(offset) {
  state.date = new Date(state.date.getFullYear(), state.date.getMonth() + offset, 1);
  state.editing = false;
  state.highlightedDay = null;
  qs("#table-scroll").scrollLeft = 0;
  subscribe();
}

function showEmployee(employee) {
  qs("#employee-modal-title").textContent = employee.name;
  qs("#first-half").textContent = String(shiftCount(employee, 1, 15));
  qs("#second-half").textContent = String(shiftCount(employee, 16, daysInMonth(state.date)));
  showModal("employee-modal");
}

function showBanquetOrHighlight(day) {
  const banquet = state.data.banquets[String(day)];
  if (!banquet?.active) {
    state.highlightedDay = state.highlightedDay === day ? null : day;
    render();
    return;
  }
  qs("#banquet-title").textContent = `Бенкет — ${day} ${monthLabel(state.date).split(" ")[0]}`;
  const details = [banquet.time && `Початок: ${banquet.time}`, banquet.guests && `Гостей: ${banquet.guests}`, banquet.note].filter(Boolean);
  qs("#banquet-details").textContent = details.join(" · ") || "Бенкет позначено без додаткових деталей.";
  renderReceipts(qs("#banquet-photos"), monthId(state.date), banquet.receiptIds || []);
  const receipts = qs("#banquet-receipts");
  receipts.replaceChildren();
  for (const url of (banquet.links || [])) {
    if (!/^https:\/\//.test(url)) continue;
    const link = document.createElement("a");
    link.className = "button secondary";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Відкрити чек ↗";
    receipts.append(link);
  }
  if (!receipts.children.length) receipts.textContent = "Посилань на чеки немає.";
  showModal("banquet-modal");
}

function askAvailability(employee, day) {
  const removing = employee.unavail.includes(day);
  state.pending = { employeeId: employee.id, day };
  qs("#confirm-title").textContent = removing ? "Прибрати вихідний?" : "Додати бажаний вихідний?";
  qs("#confirm-message").textContent = `${employee.name}, ${day} ${monthLabel(state.date).split(" ")[0]}.`;
  qs("#confirm-action").textContent = removing ? "Прибрати" : "Додати";
  showModal("confirm-modal");
}

async function confirmAvailability() {
  if (!state.pending) return;
  const { employeeId, day } = state.pending;
  const button = qs("#confirm-action");
  button.disabled = true;
  try {
    const employee = state.data.employees.find(item => String(item.id) === String(employeeId));
    if (!employee) throw new Error("Працівника не знайдено.");
    const nextDays = employee.unavail.includes(day)
      ? employee.unavail.filter(value => value !== day)
      : [...employee.unavail, day].sort((a, b) => a - b);
    await setAvailability(monthId(state.date), employeeId, nextDays);
    closeModal("confirm-modal");
    toast("Бажаний вихідний збережено.");
  } catch (error) {
    console.error(error);
    toast(error.code === "permission-denied" ? "Адміністратор має прив’язати ваш код доступу до цього працівника." : "Не вдалося зберегти зміну.", "error");
  } finally {
    button.disabled = false;
    state.pending = null;
  }
}

qs("#previous-month").addEventListener("click", () => changeMonth(-1));
qs("#next-month").addEventListener("click", () => changeMonth(1));
qs("#today").addEventListener("click", () => {
  const now = new Date();
  state.date = new Date(now.getFullYear(), now.getMonth(), 1);
  state.highlightedDay = null;
  subscribe();
});
qs("#employee-select").addEventListener("change", event => {
  state.selectedEmployeeId = event.target.value;
  state.editing = false;
  if (state.selectedEmployeeId) localStorage.setItem("kabinet.employee", state.selectedEmployeeId);
  else localStorage.removeItem("kabinet.employee");
  render();
});
qs("#edit-availability").addEventListener("click", () => { state.editing = !state.editing; render(); });
qs("#confirm-action").addEventListener("click", confirmAvailability);
qs("#share").addEventListener("click", async () => toast(await shareOrCopy(`Графік KABINET: ${monthLabel(state.date)}`)));

qs("#copy-access").addEventListener("click", async () => {
  try { const user = await ensureWorkerSession(); await navigator.clipboard.writeText(user.uid); toast("Код скопійовано. Передайте адміністратору."); }
  catch { toast("Не вдалося скопіювати код.", "error"); }
});
bindModalDismissals();
ensureWorkerSession().then(subscribe).catch(error => {
  console.error(error);
  setConnection("error", "Потрібен вхід");
  toast("Не вдалося створити гостьову сесію. Увімкніть Anonymous у Firebase Authentication.", "error");
});
