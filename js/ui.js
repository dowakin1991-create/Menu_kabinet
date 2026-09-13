const MONTHS = ["січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"];
const DAYS = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export const qs = (selector, root = document) => root.querySelector(selector);

export function monthLabel(date) {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function dutyName(year, month, day) {
  const cycle = ["🧽 Столи", "💨 Витяжки", "🍟 Фритюр"];
  const difference = Math.floor((Date.UTC(year, month, day) - Date.UTC(2026, 4, 22)) / 86_400_000);
  return cycle[((difference % cycle.length) + cycle.length) % cycle.length];
}

export function shiftType(employee, day) {
  if (employee.shifts.includes(day)) return "full";
  if (employee.shiftsFirst.includes(day)) return "first";
  if (employee.shiftsSecond.includes(day)) return "second";
  return "none";
}

export function shiftCount(employee, start, end) {
  let count = 0;
  for (let day = start; day <= end; day += 1) {
    if (employee.shifts.includes(day)) count += 1;
    if (employee.shiftsFirst.includes(day)) count += .5;
    if (employee.shiftsSecond.includes(day)) count += .5;
  }
  return count;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dayClasses(date, day, highlightedDay, banquet) {
  const dayOfWeek = new Date(date.getFullYear(), date.getMonth(), day).getDay();
  const today = new Date();
  const classes = [];
  if (dayOfWeek === 0 || dayOfWeek === 6) classes.push("weekend");
  if (today.getFullYear() === date.getFullYear() && today.getMonth() === date.getMonth() && today.getDate() === day) classes.push("today");
  if (highlightedDay === day) classes.push("highlight-day");
  if (banquet?.active) classes.push("banquet-cell");
  return classes;
}

export function renderSchedule({ table, date, data, selectedEmployeeId = null, highlightedDay = null, editableEmployeeId = null, onEmployee, onDay, onCell }) {
  const totalDays = daysInMonth(date);
  const thead = element("thead");
  const header = element("tr");
  header.append(element("th", "", "Працівник"));

  for (let day = 1; day <= totalDays; day += 1) {
    const banquet = data.banquets[String(day)];
    const th = element("th", dayClasses(date, day, highlightedDay, banquet).join(" "));
    if (banquet?.active) th.classList.add("banquet-day");
    const number = element("span", "day-number", String(day));
    const name = element("span", "day-name", DAYS[new Date(date.getFullYear(), date.getMonth(), day).getDay()]);
    const duty = element("span", "duty", dutyName(date.getFullYear(), date.getMonth(), day));
    th.append(number, name, duty);
    if (banquet?.active) th.append(element("span", "banquet-badge", "БЕНКЕТ"));
    if (onDay) {
      th.tabIndex = 0;
      th.setAttribute("role", "button");
      th.addEventListener("click", () => onDay(day));
      th.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") onDay(day);
      });
    }
    header.append(th);
  }
  thead.append(header);

  const tbody = element("tbody");
  if (!data.employees.length) {
    const row = element("tr");
    const cell = element("td", "empty-state", "У цьому місяці графік ще не створений.");
    cell.colSpan = totalDays + 1;
    row.append(cell);
    tbody.append(row);
  }

  for (const employee of data.employees) {
    const row = element("tr", String(employee.id) === String(selectedEmployeeId) ? "selected-row" : "");
    const nameCell = element("td");
    const name = element("button", "employee-name", employee.name);
    name.type = "button";
    name.style.cssText = "border:0;background:transparent;color:inherit;padding:0;width:100%;text-align:left;font:inherit";
    if (onEmployee) name.addEventListener("click", () => onEmployee(employee));
    nameCell.append(name);
    row.append(nameCell);

    for (let day = 1; day <= totalDays; day += 1) {
      const banquet = data.banquets[String(day)];
      const cell = element("td", dayClasses(date, day, highlightedDay, banquet).join(" "));
      const type = shiftType(employee, day);
      if (type !== "none") {
        const mark = element("span", `shift ${type}`);
        mark.setAttribute("aria-label", type === "full" ? "Повна зміна" : type === "first" ? "Перша половина" : "Друга половина");
        cell.append(mark);
      }
      if (employee.unavail.includes(day)) {
        const unavailable = element("span", "unavailable");
        unavailable.title = "Бажаний вихідний";
        cell.append(unavailable);
      }
      if (onCell && (editableEmployeeId === "*" || String(editableEmployeeId) === String(employee.id))) {
        cell.classList.add("editable");
        cell.tabIndex = 0;
        cell.setAttribute("role", "button");
        cell.setAttribute("aria-label", `${employee.name}, ${day}: змінити`);
        cell.addEventListener("click", () => onCell(employee, day));
        cell.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") onCell(employee, day);
        });
      }
      row.append(cell);
    }
    tbody.append(row);
  }

  table.replaceChildren(thead, tbody);
}

export function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  const focusTarget = modal.querySelector("button, input, select, textarea");
  focusTarget?.focus();
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = true;
}

export function bindModalDismissals() {
  document.addEventListener("click", event => {
    const close = event.target.closest("[data-close]");
    if (close) closeModal(close.dataset.close);
    if (event.target.classList.contains("modal-backdrop")) event.target.hidden = true;
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".modal-backdrop:not([hidden])").forEach(modal => { modal.hidden = true; });
  });
}

let toastTimer;
export function toast(message, type = "ok") {
  let node = document.getElementById("toast");
  if (!node) {
    node = element("div", "toast");
    node.id = "toast";
    node.setAttribute("role", "status");
    document.body.append(node);
  }
  node.textContent = message;
  node.className = `toast${type === "error" ? " error" : ""}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3600);
}

export function setConnection(status, text) {
  const node = document.getElementById("connection-status");
  if (!node) return;
  node.className = `status ${status}`;
  const label = node.querySelector("span");
  if (label) label.textContent = text;
}

export function scrollToToday() {
  requestAnimationFrame(() => document.querySelector(".schedule thead .today")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }));
}

export async function shareOrCopy(text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: "KABINET — графік", text, url: location.href.replace(/admin\.html.*$/, "") });
      return "Надіслано";
    } catch (error) {
      if (error.name === "AbortError") return "Скасовано";
    }
  }
  await navigator.clipboard.writeText(`${text}\n${location.href.replace(/admin\.html.*$/, "")}`);
  return "Текст і посилання скопійовано";
}

export function safePhotoUrl(url) {
  return typeof url === "string" && /^(https:\/\/firebasestorage\.googleapis\.com\/|data:image\/(jpeg|png|webp);base64,)/.test(url);
}
