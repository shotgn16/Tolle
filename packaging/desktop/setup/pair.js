'use strict';
(async () => {
  const box = document.getElementById('codes');
  try {
    const codes = await window.tolle.pairInfo();
    if (!codes.length) { box.innerHTML = '<p class="hint">Phones can only connect when Tolle is set up for this computer and your phone, or as a server.</p>'; return; }
    box.replaceChildren(...codes.map((c) => {
      const card = document.createElement('div'); card.className = 'card qr';
      const img = document.createElement('img'); img.src = c.qr; img.alt = `QR code for ${c.url}`;
      const right = document.createElement('div');
      const addr = document.createElement('div'); addr.className = 'addr'; addr.textContent = c.url;
      const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Scan with the phone camera, or type this address in the app.';
      right.append(addr, hint); card.append(img, right); return card;
    }));
  } catch (e) { box.textContent = e.message || String(e); }
})();
