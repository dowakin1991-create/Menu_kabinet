import { readReceipt } from "./store.js?v=receipts1";
import { toast } from "./ui.js?v=receipts1";

// JPEG re-encoding removes metadata and keeps each photo below the document limit.
export async function compressReceipt(file) {
  if (!file.type.startsWith("image/")) throw new Error("Оберіть фото.");
  if (file.size > 30 * 1024 * 1024) throw new Error("Оберіть фото до 30 МБ.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Не вдалося відкрити фото. Спробуйте JPEG або знімок екрана."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    let side = Math.min(2400, Math.max(image.naturalWidth, image.naturalHeight));
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.8, 0.7, 0.6]) {
        const data = canvas.toDataURL("image/jpeg", quality);
        if (data.startsWith("data:image/jpeg;base64,") && data.length <= 700000) return data;
      }
      side *= 0.8;
    }
    throw new Error("Фото надто велике. Обріжте зайвий фон і спробуйте знову.");
  } finally { URL.revokeObjectURL(url); }
}

function preview(source) {
  const dialog = document.createElement("dialog");
  dialog.className = "receipt-viewer";
  const close = document.createElement("button");
  close.className = "button";
  close.textContent = "Закрити фото";
  const image = document.createElement("img");
  image.src = source;
  image.alt = "Збільшений чек";
  const scroll = document.createElement("div");
  scroll.className = "receipt-zoom";
  scroll.append(image);
  close.onclick = () => dialog.close();
  image.onclick = () => image.classList.toggle("actual-size");
  dialog.append(close, scroll);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

export async function renderReceipts(container, month, ids, onRemove) {
  const ticket = {};
  container.receiptTicket = ticket;
  container.replaceChildren();
  if (!ids.length) { container.textContent = "Фото чеків ще немає."; return; }
  for (const [index, id] of ids.entries()) {
    const card = document.createElement("div");
    card.className = "receipt-card";
    card.textContent = "Завантаження фото…";
    container.append(card);
    readReceipt(month, id).then(source => {
      if (container.receiptTicket !== ticket) return;
      if (typeof source !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(source)) {
        throw new Error("Неправильний формат фото.");
      }
      const button = document.createElement("button");
      button.className = "receipt-thumbnail";
      button.type = "button";
      button.setAttribute("aria-label", `Збільшити чек ${index + 1}`);
      const image = document.createElement("img");
      image.src = source;
      image.alt = `Чек ${index + 1}`;
      button.append(image);
      button.onclick = () => preview(source);
      card.replaceChildren(button);
      if (onRemove) {
        const remove = document.createElement("button");
        remove.className = "button danger";
        remove.textContent = "Видалити";
        remove.onclick = async () => {
          remove.disabled = true;
          try { await onRemove(id); }
          catch { toast("Не вдалося видалити фото. Перевірте доступ.", "error"); }
          finally { remove.disabled = false; }
        };
        card.append(remove);
      }
    }).catch(() => {
      if (container.receiptTicket !== ticket) return;
      card.textContent = "Фото недоступне. Перевірте з’єднання та правила доступу.";
      const retry = document.createElement("button");
      retry.className = "button";
      retry.textContent = "Повторити";
      retry.onclick = () => renderReceipts(container, month, ids, onRemove);
      card.append(retry);
    });
  }
}
