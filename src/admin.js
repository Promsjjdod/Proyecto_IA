// ADMIN CHEAT PANEL — solo para la demo (créditos virtuales). Oculto y protegido por PIN.
// Activación: tecla  Ctrl+Shift+A  ·  o URL con  #admin  ·  o escribir "toads" en el teclado.
import { ADMIN_PIN, TOADS } from './config.js';
import { events } from './events.js';

export function initAdmin(api) {
  const KEY = 'tt_admin_session';
  let panel = null;
  let typed = '';

  const unlocked = () => sessionStorage.getItem(KEY) === '1';
  const askPin = () => {
    if (unlocked()) return true;
    const pin = prompt('ADMIN — introduce el PIN:');
    if (pin === ADMIN_PIN) { sessionStorage.setItem(KEY, '1'); return true; }
    if (pin !== null) alert('PIN incorrecto');
    return false;
  };
  const toggle = () => { if (!askPin()) return; if (!panel) { build(); panel.hidden = false; } else panel.hidden = !panel.hidden; api.message(panel.hidden ? 'Panel admin cerrado' : 'MODO ADMIN activo (demo)'); };

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') { e.preventDefault(); toggle(); return; }
    if (e.key.length === 1) { typed = (typed + e.key.toLowerCase()).slice(-5); if (typed === 'toads') { typed = ''; toggle(); } }
  });
  if (location.hash.includes('admin')) setTimeout(toggle, 400);

  function build() {
    panel = document.createElement('div');
    panel.className = 'admin';
    panel.innerHTML = `
      <div class="admin__head"><span>🐸 ADMIN · demo</span><button class="admin__x" data-act="close">×</button></div>
      <div class="admin__row"><b>Créditos</b>
        <button data-act="credits" data-v="1000">+1 000</button><button data-act="credits" data-v="10000">+10 000</button>
        <button data-act="setcredits">Fijar…</button><button data-act="credits" data-v="-999999">A cero</button></div>
      <div class="admin__row"><b>Forzar próximo giro</b>
        <button data-act="force" data-v="lose">Perder</button><button data-act="force" data-v="small">Small</button>
        <button data-act="force" data-v="medium">Medium</button><button data-act="force" data-v="big">Big</button>
        <button data-act="force" data-v="mega">Mega</button><button data-act="force" data-v="bonus">Bonus</button>
        <button data-act="force" data-v="scatter">Scatter</button><button data-act="force" data-v="anticipation">Anticipación</button></div>
      <div class="admin__row"><b>Modos</b>
        <label><input type="checkbox" data-act="alwayswin"> Siempre gana</label>
        <label><input type="checkbox" data-act="neverlose"> Nunca descuenta apuesta</label>
        <label><input type="checkbox" data-act="stats"> Mostrar FPS</label></div>
      <div class="admin__row"><b>Jackpot visual</b>
        <button data-act="jackpot" data-v="grand">GRAND</button><button data-act="jackpot" data-v="major">MAJOR</button>
        <button data-act="jackpot" data-v="minor">MINOR</button><button data-act="jackpot" data-v="mini">MINI</button></div>
      <div class="admin__row"><b>Celebración</b>
        <button data-act="celebrate" data-v="big">Big Win FX</button><button data-act="celebrate" data-v="mega">Mega Win FX</button>
        <button data-act="coins">Lluvia monedas</button></div>
      <div class="admin__row"><b>Toads</b>
        ${TOADS.map(c => `<button data-act="toadL" data-v="${c}">◀ ${c}</button>`).join('')}<br>
        ${TOADS.map(c => `<button data-act="toadR" data-v="${c}">${c} ▶</button>`).join('')}
        <button data-act="pose" data-v="win">pose win</button><button data-act="pose" data-v="shocked">pose shocked</button><button data-act="pose" data-v="idle">idle</button></div>
      <div class="admin__row"><b>Sesión</b><button data-act="spin">Girar</button><button data-act="auto">AUTO 50</button><button data-act="logout">Cerrar sesión admin</button></div>
      <div class="admin__stats" hidden></div>
      <div class="admin__log"></div>`;
    document.body.appendChild(panel);
    const log = panel.querySelector('.admin__log');
    const stats = panel.querySelector('.admin__stats');
    const addLog = (t) => { log.prepend(Object.assign(document.createElement('div'), { textContent: new Date().toLocaleTimeString() + ' · ' + t })); while (log.children.length > 8) log.lastChild.remove(); };
    for (const h of ['spin', 'reelStop', 'win', 'bigWin', 'bonus', 'scatter', 'jackpot']) events.on(h, p => addLog(h + (p ? ' ' + JSON.stringify(p) : '')));

    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const v = b.dataset.v;
      switch (b.dataset.act) {
        case 'close': panel.hidden = true; break;
        case 'credits': api.addCredits(Number(v)); addLog('créditos ' + v); break;
        case 'setcredits': { const n = Number(prompt('Créditos virtuales:', '5000')); if (!isNaN(n)) api.setCredits(n); break; }
        case 'force': api.forceNext(v); addLog('próximo giro forzado: ' + v); api.message(`ADMIN · próximo giro: ${v.toUpperCase()}`); break;
        case 'jackpot': api.ui.hitJackpot(v); break;
        case 'celebrate': api.celebrate(v); break;
        case 'coins': api.coinRain(40, 2000); break;
        case 'toadL': api.toads[0].setColor(v); break;
        case 'toadR': api.toads[1].setColor(v); break;
        case 'pose': api.toads.forEach(t => t.setState(v, true)); break;
        case 'spin': api.spin(); break;
        case 'auto': api.autoplay(50); break;
        case 'logout': sessionStorage.removeItem(KEY); panel.remove(); panel = null; api.message('Sesión admin cerrada'); break;
      }
    });
    panel.addEventListener('change', (e) => {
      const el = e.target; if (!el.dataset.act) return;
      if (el.dataset.act === 'alwayswin') api.state.alwaysWin = el.checked;
      if (el.dataset.act === 'neverlose') api.state.freeSpins = el.checked;
      if (el.dataset.act === 'stats') stats.hidden = !el.checked;
    });
    // FPS / particles readout
    let frames = 0, last = performance.now();
    const tick = () => { frames++; const now = performance.now(); if (now - last >= 1000) { if (!stats.hidden) stats.textContent = `FPS ${frames} · partículas vivas ${api.liveParticles()} · reels ${api.reelsSpinning() ? 'girando' : 'quietos'}`; frames = 0; last = now; } requestAnimationFrame(tick); };
    tick();
  }
}
