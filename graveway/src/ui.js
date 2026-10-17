/* Menus, survivor selection, the Armory, the in-game HUD and the end-of-run
   screen. All DOM work lives here; the Game reports what happened through
   the hooks below. */

import {
  WEAPONS, WEAPON_UPGRADES, PLAYER_UPGRADES, CHARACTERS, weaponStats, playerStats,
  weaponUpgradeCost, playerUpgradeCost, characterDef, weaponDef, FEEDBACK_REPO,
} from './config.js';
import { save, persist, resetSave, weaponUps, notes, persistNotes } from './save.js';
import { sfx, setSoundEnabled } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.floor(n).toLocaleString();
const coin = (n) => `<i class="coin" aria-hidden="true"></i>${fmt(n)}`;
const START_AT = [0, 200, 500, 1000];
const when = (iso) => {
  try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

const GUN_SVG = {
  pistol:   'M14 6h28v6H24l-2 2v8h-7l1-10h-2z',
  smg:      'M6 7h40v5H30v9h-5v-9h-4l-2 4h-6l2-4H6zM46 8h8v3h-8z',
  shotgun:  'M2 9l10-2h46v4H28l-2 3H16l-4 4H4l3-5z',
  rifle:    'M2 8l9-1h41v2h8v2h-8v1H34v7h-4v-7h-6l-2 6h-5l1-6h-6L4 15z',
  launcher: 'M4 7h40v8H30v7h-6v-7h-4l-3 5h-7l3-5H4zM44 6h16v10H44zM24 4h8v3h-8z',
  minigun:  'M4 6h22v12H4zM26 7h34v2.5H26zM26 10.75h34v2.5H26zM26 14.5h34v2.5H26zM10 18h6v4h-6z',
};
const gunIcon = (id) => `<svg class="gun" viewBox="0 0 64 24" aria-hidden="true"><path d="${GUN_SVG[id] || GUN_SVG.pistol}"/></svg>`;

export class UI {
  constructor() {
    this.hud = {};
    this.armoryTab = 'weapons';
    this.selWeapon = 'pistol';
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.resetArmed = false;
    this.clearArmed = false;
    this.build = '';
    this.onExit = null;           // set by main.js inside the Android app
    this.portraits = {};          // character id -> image URL, from Game.renderPortraits
    this.pick = Math.max(0, CHARACTERS.findIndex((c) => c.id === save.character));

    // What the Game calls. Bound here so `this` is the UI.
    this.hooks = {
      hud: (h) => this.updateHud(h),
      banner: (t, sub, ms) => this.banner(t, sub, ms),
      toast: (t, kind) => this.toast(t, kind),
      hurt: () => this.flashHurt(),
      finish: (r) => this.showResult(r),
    };
  }

  attach(game, input) {
    this.game = game;
    this.input = input;

    const on = (id, fn) => $(id).addEventListener('click', (e) => { sfx.click(); fn(e); });

    on('m-play', () => this.openSelect());
    on('m-armory', () => this.openArmory());
    on('m-settings', () => this.openSettings());

    on('c-back', () => this.toMenu());
    on('c-prev', () => this.cycle(-1));
    on('c-next', () => this.cycle(1));
    on('c-go', () => this.play());
    $('c-dots').addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { this.pick = Number(b.dataset.i); sfx.click(); this.renderSelect(); }
    });
    this.swipe($('c-card'), (dir) => this.cycle(dir));

    on('a-back', () => this.closeArmory());
    on('tab-weapons', () => { this.armoryTab = 'weapons'; this.renderArmory(); });
    on('tab-survivor', () => { this.armoryTab = 'survivor'; this.renderArmory(); });
    $('a-body').addEventListener('click', (e) => this.armoryClick(e));

    on('h-pause', () => this.pause());
    on('p-resume', () => this.resume());
    on('p-restart', () => this.play());
    on('p-quit', () => this.toMenu());

    on('r-next', () => this.play());
    on('r-armory', () => { this.game.showMenu(); this.openArmory(); });
    on('r-menu', () => this.toMenu());

    on('s-close', () => this.closeSettings());
    on('s-sound', () => { save.settings.sound = !save.settings.sound; setSoundEnabled(save.settings.sound); this.renderSettings(); persist(); });
    on('s-haptics', () => { save.settings.haptics = !save.settings.haptics; this.renderSettings(); persist(); });
    on('s-quality', () => {
      save.settings.quality = save.settings.quality === 'high' ? 'low' : 'high';
      this.game.setQuality(save.settings.quality);
      this.renderSettings(); persist();
    });
    on('s-notes', () => this.openNotes());
    on('t-coins', () => { save.coins += 1000; persist(); this.renderMenu(); this.toast('+1,000 coins'); });
    on('t-start', () => {
      const i = START_AT.indexOf(save.settings.startAt || 0);
      save.settings.startAt = START_AT[(i + 1) % START_AT.length];
      this.renderSettings(); persist();
    });
    on('t-god', () => { save.settings.god = !save.settings.god; this.renderSettings(); persist(); });
    on('t-fps', () => { save.settings.fps = !save.settings.fps; this.renderSettings(); persist(); });

    on('p-note', () => this.openNote());
    on('r-note', () => this.openNote());
    on('n-cancel', () => this.closeNote());
    on('n-save', () => this.saveNote());
    $('n-tags').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tag]');
      if (!b) return;
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
    });
    on('ns-close', () => this.closeNotes());
    on('ns-copy', () => this.copyNotes());
    on('ns-send', () => this.sendNotes());
    on('ns-clear', () => {
      if (!this.clearArmed) { this.clearArmed = true; $('ns-clear').textContent = 'Tap again to delete'; return; }
      notes.length = 0;
      persistNotes();
      this.openNotes();
    });

    on('s-reset', () => {
      if (!this.resetArmed) { this.resetArmed = true; this.renderSettings(); return; }
      resetSave();
      this.resetArmed = false;
      this.pick = 0;
      this.game.showMenu();
      this.renderSettings();
      this.renderMenu();
    });

    // HUD buttons sit above the joystick surface; keep their presses from
    // starting a joystick underneath.
    for (const id of ['h-pause', 'h-weapon', 'h-wbar']) {
      $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    $('h-weapon').addEventListener('click', (e) => { e.currentTarget.blur(); this.game.reload(); });
    $('h-wbar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-w]');
      if (b) { b.blur(); this.game.selectWeapon(Number(b.dataset.w)); }
    });

    input.onKey = (code, e) => {
      const st = this.game.state;
      // Mid-run, Tab and Space are game keys: don't let the browser move focus
      // or press whichever HUD button last had it.
      if (st === 'playing' && (code === 'Tab' || code === 'Space')) e.preventDefault();
      if (code === 'Escape') {
        if (this.current !== 'menu' || !$('settings').hidden) this.back();
      } else if (code === 'KeyP') {
        if (st === 'playing') this.pause();
        else if (st === 'paused') this.resume();
      } else if (code === 'KeyN' && (st === 'playing' || st === 'paused')) {
        this.pause();
        this.openNote();
      } else if (st === 'playing') {
        if (code === 'KeyR' || code === 'Space') this.game.reload();
        if (code === 'KeyQ') this.game.swapWeapon(-1);
        if (code === 'KeyE' || code === 'Tab') this.game.swapWeapon(1);
        const n = /^Digit([1-9])$/.exec(code);
        if (n) this.game.selectWeapon(Number(n[1]) - 1);
      } else if (this.current === 'select') {
        if (code === 'ArrowLeft' || code === 'KeyA') this.cycle(-1);
        if (code === 'ArrowRight' || code === 'KeyD') this.cycle(1);
        if (code === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) this.play();
      } else if (code === 'Enter' && this.current === 'menu' && !(document.activeElement instanceof HTMLButtonElement)) {
        this.openSelect();
      }
    };

    setSoundEnabled(save.settings.sound);
    this.renderMenu();
    this.show('menu');
  }

  /* Horizontal swipes on an element call fn(+1 / -1). */
  swipe(el, fn) {
    let sx = null, sy = 0;
    el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    el.addEventListener('pointerup', (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) fn(dx < 0 ? 1 : -1);
    });
  }

  /* Android back button (and Escape): close whatever is on top, pause a
     running run, and only leave the app from the main menu. */
  back() {
    if (!$('note').hidden) return this.closeNote();
    if (!$('notes').hidden) return this.closeNotes();
    if (!$('settings').hidden) return this.closeSettings();
    if (!$('result').hidden) return this.toMenu();
    if (this.current === 'armory') return this.closeArmory();
    if (this.current === 'select') return this.toMenu();
    const st = this.game.state;
    if (st === 'playing') return this.pause();
    if (st === 'paused') return this.resume();
    if (this.current === 'menu' && this.onExit) this.onExit();
  }

  show(name) {
    this.current = name;
    for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== name;
    $('hud').hidden = !['hud', 'pause'].includes(name);
    $('pause').hidden = name !== 'pause';
  }

  setPortraits(map) {
    this.portraits = map || {};
    this.hud.face = null;
    this.renderMenu();
    if (this.current === 'select') this.renderSelect();
  }

  portraitHtml(c, cls = '') {
    const src = this.portraits[c.id];
    return src
      ? `<img class="portrait ${cls}" src="${src}" alt="">`
      : `<span class="portrait ${cls} ph" aria-hidden="true">${esc(c.name[0])}</span>`;
  }

  /* ── Menu ───────────────────────────────────────────────────────────── */
  renderMenu() {
    $('m-coins').innerHTML = coin(save.coins);
    $('m-best').textContent = save.best ? `${fmt(save.best)} m` : '—';
    $('m-runs').textContent = save.runs ? `${save.runs} run${save.runs === 1 ? '' : 's'} · ${fmt(save.kills)} kills` : 'No runs yet';
    const unsent = notes.filter((n) => !n.sent).length;
    $('m-notes-badge').textContent = unsent;
    $('m-notes-badge').hidden = !unsent;
    const c = characterDef(save.character);
    $('m-char').innerHTML = `${this.portraitHtml(c, 'sm')}<span><small>Survivor</small><b>${esc(c.name)}</b></span>`;
  }

  toMenu() {
    this.input.setEnabled(false);
    this.hideBanner();
    $('result').hidden = true;
    this.game.showMenu();
    this.renderMenu();
    this.show('menu');
  }

  /* ── Survivor selection ──────────────────────────────────────────────── */
  openSelect() {
    this.pick = Math.max(0, CHARACTERS.findIndex((c) => c.id === save.character));
    this.renderSelect();
    this.show('select');
  }

  cycle(d) {
    this.pick = (this.pick + d + CHARACTERS.length) % CHARACTERS.length;
    sfx.click();
    this.renderSelect();
  }

  renderSelect() {
    const c = CHARACTERS[this.pick];
    // The survivor on the street behind the menu changes too.
    if (save.character !== c.id) {
      save.character = c.id;
      persist();
      this.game.showMenu();
    }
    const maxHp = Math.max(...CHARACTERS.map((x) => x.baseHealth));
    const maxSp = Math.max(...CHARACTERS.map((x) => x.moveSpeed));
    const st = playerStats(c, save.pup);
    const w = weaponDef(c.startingWeapon);
    const owned = save.owned.includes(w.id) || w.price === 0;
    const bar = (label, v, max, text) =>
      `<div class="stat"><span>${label}</span><i style="--v:${Math.min(1, v / max)}"></i><b>${text}</b></div>`;
    $('c-card').innerHTML = `
      ${this.portraitHtml(c, 'lg')}
      <div class="c-name"><h2>${esc(c.name)}</h2><span class="pill">${esc(c.role)}</span></div>
      <p class="blurb">${esc(c.blurb)}</p>
      ${bar('Health', c.baseHealth, maxHp, `${st.maxHp} HP`)}
      ${bar('Speed', c.moveSpeed, maxSp, `${st.speed.toFixed(1)} m/s`)}
      <div class="perk"><small>Perk</small><b>${esc(c.perk.name)}</b><span>${esc(c.perk.text)}</span></div>
      <div class="perk gunline">${gunIcon(w.id)}<span><small>Brings</small><b>${esc(w.name)}</b>
        <span>${owned ? 'Plus every gun you own' : 'Theirs for the run, even before you buy it'}</span></span></div>`;
    $('c-dots').innerHTML = CHARACTERS.map((x, i) =>
      `<button type="button" data-i="${i}" aria-label="${esc(x.name)}" aria-pressed="${i === this.pick}"></button>`).join('');
    $('c-go').textContent = `Run as ${c.name}`;
  }

  play() {
    this.hideBanner();
    this.hud = {};
    $('result').hidden = true;
    this.show('hud');
    this.game.start();
    this.input.setEnabled(true);
  }

  pause() {
    if (this.game.state !== 'playing') return;
    this.game.pause();
    this.input.setEnabled(false);
    $('p-level').textContent = `${fmt(this.game.distance)} m · stage ${this.game.stage + 1}`;
    this.show('pause');
  }

  resume() {
    this.game.resume();
    this.input.setEnabled(true);
    this.show('hud');
  }

  /* ── HUD ─────────────────────────────────────────────────────────────── */
  updateHud(h) {
    const c = this.hud;
    const set = (key, val, fn) => { if (c[key] !== val) { c[key] = val; fn(val); } };
    set('dist', h.distance, (v) => { $('h-dist').textContent = `${fmt(v)} m`; });
    set('stage', h.stage, (v) => { $('h-stage').textContent = `Stage ${v + 1}`; });
    set('prog', Math.round(h.stageProgress * 100), (v) => { $('h-prog').style.setProperty('--p', v / 100); });
    set('coins', h.coins, (v) => { $('h-coins').innerHTML = coin(v); });
    set('kills', h.kills, (v) => { $('h-kills').textContent = `${v} kill${v === 1 ? '' : 's'}`; });
    set('face', this.game.character.id, () => { $('h-face').innerHTML = this.portraitHtml(this.game.character, 'sm'); });
    set('hp', Math.ceil(h.hp) + '/' + h.maxHp, () => {
      $('h-hp').style.setProperty('--v', Math.max(0, h.hp) / h.maxHp);
      $('h-hp-n').textContent = Math.ceil(h.hp);
    });
    set('armor', Math.ceil(h.armor), (v) => {
      $('h-armor').style.setProperty('--v', v / h.maxArmor);
      $('h-armor-row').hidden = v <= 0;
      $('h-armor-n').textContent = v;
    });

    // Weapon bar: one button per gun in hand, with a strip showing its ammo.
    const ws = h.weapons;
    set('wbar', ws.map((w) => w.id).join(','), () => {
      $('h-wbar').innerHTML = ws.length < 2 ? '' : ws.map((w, i) =>
        `<button type="button" tabindex="-1" data-w="${i}" aria-label="${esc(w.name)}">${gunIcon(w.id)}<i></i><span>${i + 1}</span></button>`).join('');
      c.wsel = null;
    });
    if (ws.length > 1) {
      set('wsel', h.wi, (v) => {
        for (const b of $('h-wbar').children) b.setAttribute('aria-pressed', Number(b.dataset.w) === v);
      });
      const btns = $('h-wbar').children;
      for (let i = 0; i < btns.length && i < ws.length; i++) {
        const w = ws[i];
        const v = w.reloading ? 0 : w.ammo / w.stats.ammoCapacity;
        set('wa' + i, Math.round(v * 20), (q) => btns[i].style.setProperty('--a', q / 20));
      }
    }
    const w = ws[h.wi];
    set('weapon', w.name, (v) => { $('h-wname').textContent = v; });
    set('ammo', w.reloading ? 'reload' : `${w.ammo}/${w.stats.ammoCapacity}`, () => {
      $('h-ammo').textContent = w.reloading ? '···' : w.ammo;
      $('h-mag').textContent = `/ ${w.stats.ammoCapacity}`;
      $('h-weapon').classList.toggle('empty', !w.reloading && w.ammo === 0);
    });
    const rp = w.reloadProgress;
    set('reload', rp === null ? -1 : Math.round(rp * 50), (v) => {
      $('h-weapon').classList.toggle('reloading', v >= 0);
      $('h-weapon').style.setProperty('--r', v < 0 ? 0 : v / 50);
    });
    set('boss', h.boss === null ? -1 : Math.round(h.boss * 100), (v) => {
      $('h-boss').hidden = v < 0;
      $('h-boss').style.setProperty('--v', Math.max(0, v) / 100);
    });
    set('low', h.low, (v) => { $('vignette').classList.toggle('low', v); });
    const dbg = [h.god ? 'INVINCIBLE' : '', h.fps !== null ? `${h.fps} fps · ${h.zombies} up` : ''].filter(Boolean).join(' · ');
    set('dbg', dbg, (v) => { $('h-debug').textContent = v; $('h-debug').hidden = !v; });
  }

  flashHurt() {
    const v = $('vignette');
    v.classList.remove('hit');
    void v.offsetWidth; // restart the animation
    v.classList.add('hit');
  }

  banner(title, sub, ms = 2200) {
    const b = $('banner');
    $('banner-t').textContent = title;
    $('banner-s').textContent = sub || '';
    $('banner-s').hidden = !sub;
    b.hidden = false;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.hideBanner(), ms);
  }

  hideBanner() {
    clearTimeout(this.bannerTimer);
    $('banner').hidden = true;
  }

  toast(text, kind) {
    const t = $('toast');
    t.textContent = text;
    t.dataset.kind = kind || '';
    t.hidden = false;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, 1300);
  }

  /* ── Results ─────────────────────────────────────────────────────────── */
  showResult(r) {
    persist();
    this.lastResult = r;
    this.input.setEnabled(false);
    this.hideBanner();
    $('r-title').textContent = 'Overrun';
    $('r-dist').textContent = `${fmt(r.distance)} m`;
    $('r-sub').textContent = r.best ? 'New best!' : `Stage ${r.stage + 1} · ${Math.round(r.time)}s · ${r.character}${r.startAt ? ` · started at ${r.startAt} m` : ''}`;
    $('result').dataset.best = r.best;
    const rows = [
      ['Zombies down', fmt(r.kills)],
      ['Coins picked up', coin(r.coins)],
      [`Stage bonuses (${r.stage})`, coin(r.bonus)],
      ['Total', coin(r.total)],
    ];
    $('r-stats').innerHTML = rows.map(([k, v], i) =>
      `<div class="row${i === rows.length - 1 ? ' total' : ''}"><span>${k}</span><b>${v}</b></div>`).join('');
    $('r-wallet').innerHTML = `Wallet: ${coin(save.coins)} · Best: ${fmt(save.best)} m`;
    $('r-tip').textContent = this.tip();
    $('result').hidden = false;
    this.current = 'result';
    $('hud').hidden = true;
  }

  tip() {
    const cheapest = this.cheapestUpgrade();
    if (cheapest && cheapest.cost <= save.coins) return `You can afford ${cheapest.label} in the Armory.`;
    const tips = [
      'Keep moving: stragglers keep coming even when you stand still.',
      'Red barrels go up with a crowd round them. Your aim knows that.',
      'Armor soaks most of a hit. Grab the blue vests.',
      'Runners have red eyes. Deal with them first.',
      'Tanks smash straight through barricades. Don\'t hide behind one.',
      'Rubble slows everything that crosses it, including you.',
      'Coins you pick up are yours to keep, even if you fall.',
      'Each survivor brings their own gun. Juno\'s launcher flattens walls.',
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  cheapestUpgrade() {
    let best = null;
    const consider = (cost, label) => { if (!best || cost < best.cost) best = { cost, label }; };
    WEAPONS.forEach((w, i) => {
      if (w.price && !save.owned.includes(w.id)) { consider(w.price, `the ${w.name}`); return; }
      for (const k of Object.keys(WEAPON_UPGRADES)) {
        const lv = weaponUps(w.id)[k] || 0;
        if (lv < WEAPON_UPGRADES[k].max) consider(weaponUpgradeCost(i, k, lv), `a ${w.name} ${WEAPON_UPGRADES[k].label.toLowerCase()} upgrade`);
      }
    });
    for (const k of Object.keys(PLAYER_UPGRADES)) {
      const lv = save.pup[k] || 0;
      if (lv < PLAYER_UPGRADES[k].max) consider(playerUpgradeCost(k, lv), `more ${PLAYER_UPGRADES[k].label.toLowerCase()}`);
    }
    return best;
  }

  /* ── Armory ──────────────────────────────────────────────────────────── */
  openArmory() {
    $('result').hidden = true;
    this.renderArmory();
    this.show('armory');
  }

  closeArmory() {
    this.renderMenu();
    this.show('menu');
  }

  renderArmory() {
    $('a-coins').innerHTML = coin(save.coins);
    $('tab-weapons').setAttribute('aria-selected', this.armoryTab === 'weapons');
    $('tab-survivor').setAttribute('aria-selected', this.armoryTab === 'survivor');
    $('a-body').innerHTML = this.armoryTab === 'weapons' ? this.weaponsHtml() : this.survivorHtml();
  }

  weaponsHtml() {
    const maxes = { dmg: 0, rate: 0, range: 0, mag: 0 };
    const all = WEAPONS.map((w) => weaponStats(w, weaponUps(w.id)));
    for (const s of all) {
      maxes.dmg = Math.max(maxes.dmg, s.damage * s.pellets);
      maxes.rate = Math.max(maxes.rate, s.fireRate);
      maxes.range = Math.max(maxes.range, s.range);
      maxes.mag = Math.max(maxes.mag, s.ammoCapacity);
    }
    const isOwned = (w) => w.price === 0 || save.owned.includes(w.id);
    const cards = WEAPONS.map((w) => {
      const owned = isOwned(w);
      const sig = CHARACTERS.find((c) => c.startingWeapon === w.id && w.price > 0);
      const tag = owned ? 'Owned' : coin(w.price);
      return `<button class="wcard${owned ? ' owned' : ''}${w.id === this.selWeapon ? ' sel' : ''}"
        data-act="sel" data-id="${w.id}" aria-pressed="${w.id === this.selWeapon}">
        ${gunIcon(w.id)}
        <span class="wn">${esc(w.name)}</span><span class="wt">${tag}</span>${sig ? `<span class="wsig">${esc(sig.name)}'s gun</span>` : ''}</button>`;
    }).join('');

    const wi = WEAPONS.findIndex((w) => w.id === this.selWeapon);
    const w = WEAPONS[wi];
    const s = all[wi];
    const owned = isOwned(w);
    const bar = (label, v, max, text) =>
      `<div class="stat"><span>${label}</span><i style="--v:${Math.min(1, v / max)}"></i><b>${text}</b></div>`;
    const deg = (r) => (r * 57.3).toFixed(1);
    const fine = [`Reload ${s.reloadTime.toFixed(1)}s`, `spread ${deg(s.spread)}°`];
    if (w.recoil) fine.push(`recoil up to ${deg(s.spread + w.recoil.max)}°`);
    if (w.blast) fine.push(`${w.blast.radius} m blast`);
    if (w.pierce) fine.push(`pierces ${w.pierce}`);
    let html = `<div class="wgrid">${cards}</div>
      <div class="panel wdetail">
        <div class="wd-head"><h3>${esc(w.name)}</h3>${owned ? '<span class="pill">In your loadout</span>' : ''}</div>
        <p class="blurb">${esc(w.blurb)}</p>
        ${bar(w.projectile === 'grenade' ? 'Blast' : 'Damage', s.damage * s.pellets, maxes.dmg, s.pellets > 1 ? `${Math.round(s.damage)}×${s.pellets}` : Math.round(s.damage))}
        ${bar('Fire rate', s.fireRate, maxes.rate, `${s.fireRate.toFixed(1)}/s`)}
        ${bar('Range', s.range, maxes.range, `${s.range} m`)}
        ${bar('Magazine', s.ammoCapacity, maxes.mag, s.ammoCapacity)}
        <p class="fine">${fine.join(' · ')}</p>`;
    if (!owned) {
      const can = save.coins >= w.price;
      html += `<button class="btn primary wide" data-act="buy" data-id="${w.id}" ${can ? '' : 'aria-disabled="true"'}>
        Unlock for ${coin(w.price)}</button>`;
      if (!can) html += `<p class="need">${fmt(w.price - save.coins)} more coins needed</p>`;
    }
    html += '<h4>Upgrades</h4>';
    for (const [k, u] of Object.entries(WEAPON_UPGRADES)) {
      const lv = weaponUps(w.id)[k] || 0;
      html += this.upgradeRow(`w:${w.id}:${k}`, u.label, lv, u.max, lv < u.max ? weaponUpgradeCost(wi, k, lv) : null,
        `+${Math.round(u.step * 100)}% each`);
    }
    return html + '</div>';
  }

  survivorHtml() {
    const c = characterDef(save.character);
    const st = playerStats(c, save.pup);
    const now = { maxHp: `${st.maxHp} HP`, speed: `${st.speed.toFixed(1)} m/s`, magnet: `${st.magnet.toFixed(1)} m` };
    let html = `<div class="panel"><p class="blurb">These stay with you, whichever survivor you pick. Shown for ${esc(c.name)}.</p>`;
    for (const [k, u] of Object.entries(PLAYER_UPGRADES)) {
      const lv = save.pup[k] || 0;
      const step = u.unit === '%' ? `+${Math.round(u.step * 100)}%` : `+${u.step}${u.unit}`;
      html += this.upgradeRow(`p:${k}`, u.label, lv, u.max, lv < u.max ? playerUpgradeCost(k, lv) : null, `${now[k]} · ${step} each`);
    }
    return html + '</div>';
  }

  upgradeRow(key, label, lv, max, cost, sub) {
    const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
    const btn = cost === null
      ? '<span class="pill">Max</span>'
      : `<button class="btn small buy" data-act="up" data-key="${key}" ${save.coins >= cost ? '' : 'aria-disabled="true"'}>${coin(cost)}</button>`;
    return `<div class="uprow"><div class="ul"><b>${esc(label)}</b><small>${esc(sub)}</small><span class="pips">${pips}</span></div>${btn}</div>`;
  }

  armoryClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'sel') {
      this.selWeapon = b.dataset.id;
      sfx.click();
    } else if (act === 'buy') {
      const w = WEAPONS.find((x) => x.id === b.dataset.id);
      if (save.coins < w.price) { sfx.denied(); this.nudge(b); return; }
      save.coins -= w.price;
      save.owned.push(w.id);
      sfx.buy();
    } else if (act === 'up') {
      const [kind, a, c] = b.dataset.key.split(':');
      let cost;
      if (kind === 'w') {
        const wi = WEAPONS.findIndex((x) => x.id === a);
        const ups = weaponUps(a);
        cost = weaponUpgradeCost(wi, c, ups[c] || 0);
        if (save.coins < cost) { sfx.denied(); this.nudge(b); return; }
        ups[c] = (ups[c] || 0) + 1;
      } else {
        cost = playerUpgradeCost(a, save.pup[a] || 0);
        if (save.coins < cost) { sfx.denied(); this.nudge(b); return; }
        save.pup[a] = (save.pup[a] || 0) + 1;
      }
      save.coins -= cost;
      sfx.buy();
    }
    persist();
    const scroll = $('a-body').scrollTop;
    this.renderArmory();
    $('a-body').scrollTop = scroll;
  }

  nudge(el) {
    el.classList.remove('nudge');
    void el.offsetWidth;
    el.classList.add('nudge');
  }

  /* ── Playtest notes ──────────────────────────────────────────────────────
     A note records what was happening when you wrote it, so "this is too
     hard" arrives with the distance, survivor, gun, health and frame rate. */
  noteContext() {
    const g = this.game;
    const fps = `${Math.round(g.fps)} fps`;
    if (!$('result').hidden && this.lastResult) {
      const r = this.lastResult;
      return `After a run: ${r.character}, ${r.distance} m (stage ${r.stage + 1}) in ${Math.round(r.time)}s, ${r.kills} kills · ${this.loadoutText()} · ${fps}`;
    }
    if (g.run && ['playing', 'paused', 'dying'].includes(g.state)) {
      const p = g.player;
      return `${g.character.name} · ${Math.floor(g.distance)} m (stage ${g.stage + 1}) · ${g.weapon.name} · ${Math.round(g.run.time)}s in · ` +
        `${Math.ceil(p.hp)}/${p.maxHp} HP${p.armor > 0 ? ` + ${Math.ceil(p.armor)} armor` : ''} · ` +
        `${g.run.kills} kills · ${g.alive()} zombies up · ${fps}`;
    }
    const where = { armory: 'Armory', select: 'Survivor select' }[this.current] || 'Menu';
    return `${where} · ${this.loadoutText()} · ${fps}`;
  }

  loadoutText() {
    const ups = (id) => Object.values(weaponUps(id)).reduce((a, b) => a + b, 0);
    const guns = WEAPONS.filter((w) => w.price === 0 || save.owned.includes(w.id)).map((w) => {
      const n = ups(w.id);
      return w.name + (n ? ` +${n}` : '');
    });
    return `${save.coins} coins · best ${save.best} m · guns: ${guns.join(', ')}`;
  }

  openNote() {
    this.noteCtx = this.noteContext();
    $('n-context').textContent = this.noteCtx;
    $('n-text').value = '';
    for (const b of $('n-tags').querySelectorAll('[data-tag]')) b.setAttribute('aria-pressed', 'false');
    $('note').hidden = false;
    $('n-text').focus();
  }

  closeNote() {
    $('note').hidden = true;
    $('n-text').blur();
  }

  saveNote() {
    const text = $('n-text').value.trim();
    const tags = [...$('n-tags').querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.tag);
    if (!text && !tags.length) { sfx.denied(); this.nudge($('n-save')); return; }
    notes.push({ at: new Date().toISOString(), tags, text, ctx: this.noteCtx });
    persistNotes();
    this.closeNote();
    const unsent = notes.filter((n) => !n.sent).length;
    this.toast(`Note saved · ${unsent} to send (Settings → Playtest notes)`);
  }

  notesText() {
    const head = `Graveway playtest notes\n${this.build || 'Web'} · screen ${window.innerWidth}×${window.innerHeight} · ${notes.length} note${notes.length === 1 ? '' : 's'}\n`;
    return head + notes.map((n, i) =>
      `\n${i + 1}. ${n.tags.length ? `[${n.tags.join(', ')}] ` : ''}${n.text || '(no comment)'}\n   ${n.ctx}\n   ${when(n.at)}${n.sent ? ' · sent' : ''}`).join('\n');
  }

  openNotes() {
    this.clearArmed = false;
    const unsent = notes.filter((n) => !n.sent).length;
    $('ns-clear').textContent = 'Delete all';
    $('ns-clear').disabled = !notes.length;
    $('ns-copy').disabled = !notes.length;
    $('ns-send').disabled = !notes.length;
    $('ns-send').textContent = unsent || !notes.length ? 'Send to Claude' : 'Send all again';
    $('ns-text').value = notes.length ? this.notesText() : 'No notes yet. While playing, pause and tap "Leave a note".';
    $('ns-count').textContent = !notes.length ? ''
      : `${notes.length} note${notes.length === 1 ? '' : 's'}${!unsent ? ' · all sent' : unsent < notes.length ? ` · ${unsent} not sent yet` : ''}`;
    $('notes').hidden = false;
  }

  /* "Send to Claude": opens a new GitHub issue on FEEDBACK_REPO with the
     notes filled in, so all that's left is tapping Submit. Notes not sent
     before go first; if they've all been sent, they all go again. A URL can
     only carry so much, so a long backlog goes over several sends. */
  sendNotes() {
    const unsent = notes.filter((n) => !n.sent);
    const pool = unsent.length ? unsent : notes.slice();
    if (!pool.length) return;
    const base = `https://github.com/${FEEDBACK_REPO}/issues/new?`;
    const build = (list, left) => {
      const title = `Playtest notes: ${list.length} from ${this.build || 'Web'}`;
      const body = this.issueBody(list, left);
      return { body, url: `${base}title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}` };
    };
    let n = pool.length, out = build(pool, 0);
    while (out.url.length > 7000 && n > 1) { n--; out = build(pool.slice(0, n), pool.length - n); }
    if (out.url.length > 7000) {
      // One enormous note: send the start of it.
      const one = { ...pool[0], text: pool[0].text.slice(0, 2500) + ' …(cut short)' };
      out = build([one], pool.length - 1);
    }
    const at = new Date().toISOString();
    for (const x of pool.slice(0, n)) x.sent = at;
    persistNotes();
    // A copy on the clipboard too, in case the page opens with an empty form.
    try { navigator.clipboard?.writeText(out.body).catch(() => {}); } catch { /* no clipboard */ }
    this.openExternal(out.url);
    this.toast(pool.length > n ? `Sending ${n} of ${pool.length} · send again for the rest` : 'Tap Submit on GitHub to send it');
    this.openNotes();
    this.renderMenu();
  }

  issueBody(list, left) {
    const lines = [
      '<!-- graveway-playtest -->',
      `**Build:** ${this.build || 'Web'} · screen ${window.innerWidth}×${window.innerHeight}`,
      `**Sent:** ${when(new Date().toISOString())}`,
      '',
    ];
    list.forEach((n, i) => {
      lines.push(`${i + 1}. ${n.tags.length ? `**[${n.tags.join(', ')}]** ` : ''}${n.text || '(no comment)'}`);
      lines.push(`   _${n.ctx}_`);
      lines.push(`   _${when(n.at)}_`);
    });
    if (left) lines.push('', `_${left} more note${left === 1 ? '' : 's'} didn't fit. They'll come in the next send._`);
    return lines.join('\n');
  }

  /* Inside the Android app, the WebView hands outside links to the phone's
     browser and stays on the game; in a browser, use a new tab. */
  openExternal(url) {
    if (window.Capacitor?.isNativePlatform?.()) { window.location.href = url; return; }
    const w = window.open(url, '_blank');
    if (w) w.opener = null;
    else window.location.href = url;
  }

  closeNotes() {
    $('notes').hidden = true;
    this.renderSettings();
  }

  async copyNotes() {
    const text = this.notesText();
    try {
      await navigator.clipboard.writeText(text);
      this.toast('Copied — paste it to Claude');
    } catch {
      // No clipboard access (some webviews): select it so a long-press copies.
      const t = $('ns-text');
      t.focus();
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* not supported */ }
      this.toast(ok ? 'Copied — paste it to Claude' : 'Selected — long-press to copy');
    }
  }

  /* ── Settings ────────────────────────────────────────────────────────── */
  openSettings() {
    this.resetArmed = false;
    this.renderSettings();
    $('settings').hidden = false;
  }

  closeSettings() {
    $('settings').hidden = true;
  }

  renderSettings() {
    const s = save.settings;
    const sw = (id, on, label) => { const b = $(id); b.setAttribute('aria-checked', on); b.querySelector('b').textContent = label; };
    sw('s-sound', s.sound, s.sound ? 'On' : 'Off');
    sw('s-haptics', s.haptics, s.haptics ? 'On' : 'Off');
    sw('s-quality', s.quality === 'high', s.quality === 'high' ? 'High' : 'Battery saver');
    sw('t-start', !!s.startAt, `${s.startAt || 0} m`);
    sw('t-god', s.god, s.god ? 'On' : 'Off');
    sw('t-fps', s.fps, s.fps ? 'On' : 'Off');
    $('s-notes-n').textContent = notes.length;
    $('s-version').textContent = `Graveway · ${this.build || 'Web'}`;
    $('s-reset').textContent = this.resetArmed ? 'Tap again to erase everything' : 'Reset progress';
    $('s-reset').classList.toggle('armed', this.resetArmed);
  }
}
