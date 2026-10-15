import { daysInMonth, dutyName, monthLabel, shiftType } from './ui.js?v=20261015.2';

// Canvas draws text directly: no HTML injection, remote renderer or CSS-mask support needed.
export async function exportHalfMonth(date, data, half) {
  const start = half === 1 ? 1 : 16;
  const end = half === 1 ? 15 : daysInMonth(date);
  const cell = 62, nameWidth = 210, rowHeight = 46, top = 130;
  const width = nameWidth + (end - start + 1) * cell + 40;
  const height = top + Math.max(1, data.employees.length) * rowHeight + 55;
  if (height > 8000) throw new Error('Забагато працівників для одного зображення.');
  const canvas = document.createElement('canvas');
  canvas.width = width * 2; canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступний.');
  ctx.scale(2, 2);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#155e63'; ctx.textAlign = 'center'; ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`KABINET · ${monthLabel(date)} · ${start}–${end}`, width / 2, 35);
  function box(x, y, w, h, color) {
    ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  }
  box(20, 55, nameWidth, top - 55, '#155e63');
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('Працівник', 20 + nameWidth / 2, 94);
  for (let day = start; day <= end; day++) {
    const x = 20 + nameWidth + (day - start) * cell;
    const weekend = [0, 6].includes(new Date(date.getFullYear(), date.getMonth(), day).getDay());
    const banquet = data.banquets[String(day)]?.active;
    box(x, 55, cell, top - 55, banquet ? '#c46710' : weekend ? '#334155' : '#155e63');
    ctx.fillStyle = '#fff'; ctx.font = 'bold 17px sans-serif'; ctx.fillText(String(day), x + cell / 2, 77);
    ctx.font = '12px sans-serif'; ctx.fillText(['Нд','Пн','Вт','Ср','Чт','Пт','Сб'][new Date(date.getFullYear(),date.getMonth(),day).getDay()], x + cell / 2, 94);
    ctx.font = '10px sans-serif'; ctx.fillText(dutyName(date.getFullYear(),date.getMonth(),day).split(' ').slice(1).join(' '), x + cell / 2, 108);
    if (banquet) ctx.fillText('БЕНКЕТ', x + cell / 2, 122);
    data.employees.forEach((employee, index) => {
      const y = top + index * rowHeight;
      box(x, y, cell, rowHeight, banquet ? '#fff3df' : weekend ? '#edf1f4' : '#fff');
      const type = shiftType(employee, day), cx = x + cell / 2, cy = y + 19;
      ctx.strokeStyle = '#155e63'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      if (type !== 'none') {
        ctx.beginPath(); ctx.moveTo(cx - 7, cy + 7); ctx.lineTo(cx + 7, cy - 7);
        if (type === 'full' || type === 'first') { ctx.moveTo(cx - 7, cy - 7); ctx.lineTo(cx, cy); }
        if (type === 'full' || type === 'second') { ctx.moveTo(cx, cy); ctx.lineTo(cx + 7, cy + 7); }
        ctx.stroke();
      }
      if (employee.unavail.includes(day)) { ctx.fillStyle = '#e34242'; ctx.beginPath(); ctx.arc(cx, y + 35, 3, 0, Math.PI * 2); ctx.fill(); }
    });
  }
  data.employees.forEach((employee, index) => {
    box(20, top + index * rowHeight, nameWidth, rowHeight, '#f1f7f7');
    ctx.fillStyle = '#183438'; ctx.textAlign = 'left'; ctx.font = 'bold 15px sans-serif';
    let name = employee.name;
    while (ctx.measureText(name).width > nameWidth - 24 && name.length) name = name.slice(0, -1);
    if (name !== employee.name) name = name.slice(0, -1) + '…';
    ctx.fillText(name, 30, top + index * rowHeight + 28);
  });
  ctx.fillStyle = '#475569'; ctx.textAlign = 'left'; ctx.font = '12px sans-serif';
  ctx.fillText('Червона крапка — бажаний вихідний. Половина позначки — половина зміни.', 20, height - 20);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Не вдалося створити PNG.');
  const url = URL.createObjectURL(blob);
  const dialog = document.createElement('dialog'); dialog.className = 'receipt-viewer';
  const close = document.createElement('button'); close.className = 'button'; close.textContent = 'Закрити'; close.onclick = () => dialog.close();
  const download = document.createElement('a'); download.className = 'button'; download.textContent = 'Завантажити PNG'; download.href = url;
  download.download = `kabinet-${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${start}-${end}.png`;
  const image = new Image(); image.src = url; image.alt = `Графік за ${start}–${end}`; image.style.cssText = 'max-width:100%;height:auto;display:block';
  dialog.append(close, download, image); document.body.append(dialog);
  dialog.addEventListener('close', () => { URL.revokeObjectURL(url); dialog.remove(); }, { once: true });
  dialog.showModal();
}
