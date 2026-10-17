/* Menus, the Armory, the in-game HUD and the end-of-level screens. All DOM
   work lives here; the Game reports what happened through the hooks below. */

import {
  WEAPONS, WEAPON_UPGRADES, PLAYER_UPGRADES, weaponStats, playerStats,
  weaponUpgradeCost, playerUpgradeCost, levelSpec,
} from './config.js';
import { save, persist, resetSave, weaponUps, notes, persistNotes } from './save.js';
import { sfx, setSoundEnabled } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.floor(n).toLocaleString();
const coin = (n) => `<i class="coin" aria-hidden="true"></i>${fmt(n)}`;

const GUN_SVG = {
  pistol:  'M14 6h28v6H24l-2 2v8h-7l1-10h-2z',
  smg:     'M6 7h40v5H30v9h-5v-9h-4l-2 4h-6l2-4H6zM46 8h8v3h-8z',
  shotgun: 'M2 9l10-2h46v4H28l-2 3H16l-4 4H4l3-5z',
  rifle:   'M2 8l9-1h41v2h8v2h-8v1H34v7h-4v-7h-6l-2 6h-5l1-6h-6L4 15z',
  minigun: 'M4 6h22v12H4zM26 7h34v2.5H26zM26 10.75h34v2.5H26zM26 14.5h34v2.5H26zM10 18h6v4h-6z',
};
const gunIcon = (id) => `<svg class="gun" viewBox="0 0 64 24" aria-hidden="true"><path d="${GUN_SVG[id] || GUN_SVG.pistol}"/></svg>`;

export class UI {
  constructor() {
    this.hud = {};
    this.armoryTab = 'weapons';
    this.selWeapon = save.equipped;
    this.armoryFrom = 'menu';
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.resetArmed = false;
    this.clearArmed = false;
    this.build = '';
    this.onExit = null;           // set by main.js inside the Android app

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

    on('m-play', () => this.play(save.level));
    on('m-armory', () => this.openArmory('menu'));
    on('m-settings', () => this.openSettings());
    on('lv-prev', () => this.pickLevel(-1));
    on('lv-next', () => this.pickLevel(1));

    on('a-back', () => this.closeArmory());
    on('tab-weapons', () => { this.armoryTab = 'weapons'; this.renderArmory(); });
    on('tab-survivor', () => { this.armoryTab = 'survivor'; this.renderArmory(); });
    $('a-body').addEventListener('click', (e) => this.armoryClick(e));

    on('h-pause', () => this.pause());
    on('p-resume', () => this.resume());
    on('p-restart', () => this.play(this.game.levelNum));
    on('p-quit', () => this.toMenu());

    on('r-next', () => this.play(this.lastResult.won ? this.lastResult.level + 1 : this.lastResult.level));
    on('r-armory', () => { this.game.showMenu(); this.openArmory('menu'); });
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
    on('t-levels', () => {
      save.unlocked = Math.max(save.unlocked, 25);
      persist(); this.renderMenu(); this.toast('Levels 1–25 unlocked');
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
      this.selWeapon = save.equipped;
      this.game.showMenu();
      this.renderSettings();
      this.renderMenu();
    });

    // Buttons in the HUD sit above the joystick surface; keep their presses
    // from starting a joystick underneath.
    for (const id of ['h-pause', 'h-weapon', 'h-swap']) {
      $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    $('h-weapon').addEventListener('click', () => this.game.reload());
    $('h-swap').addEventListener('click', () => this.game.swapWeapon(1));

    input.onKey = (code) => {
      const st = this.game.state;
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
      } else if (code === 'Enter' && this.current === 'menu' && !(document.activeElement instanceof HTMLButtonElement)) {
        this.play(save.level);
      }
    };

    setSoundEnabled(save.settings.sound);
    this.renderMenu();
    this.show('menu');
  }

  /* Android back button (and Escape): close whatever is on top, pause a
     running level, and only leave the app from the main menu. */
  back() {
    if (!$('note').hidden) return this.closeNote();
    if (!$('notes').hidden) return this.closeNotes();
    if (!$('settings').hidden) return this.closeSettings();
    if (!$('result').hidden) return this.toMenu();
    if (this.current === 'armory') return this.closeArmory();
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

  /* ── Menu ───────────────────────────────────────────────────────────── */
  renderMenu() {
    save.level = Math.max(1, Math.min(save.level, save.unlocked));
    $('m-coins').innerHTML = coin(save.coins);
    $('lv-num').textContent = save.level;
    const spec = levelSpec(save.level);
    $('lv-tag').textContent = spec.boss ? 'Boss level' : save.level === save.unlocked ? 'New' : 'Replay';
    $('lv-tag').dataset.kind = spec.boss ? 'boss' : '';
    $('lv-prev').disabled = save.level <= 1;
    $('lv-next').disabled = save.level >= save.unlocked;
    $('m-play').textContent = save.level === 1 && save.unlocked === 1 ? 'Start' : `Play level ${save.level}`;
  }

  pickLevel(d) {
    save.level = Math.max(1, Math.min(save.unlocked, save.level + d));
    persist();
    this.renderMenu();
  }

  play(level) {
    save.level = level;
    persist();
    this.hideBanner();
    this.hud = {};
    $('result').hidden = true;
    this.show('hud');
    this.game.start(level);
    this.input.setEnabled(true);
  }

  toMenu() {
    this.input.setEnabled(false);
    this.hideBanner();
    $('result').hidden = true;
    this.game.showMenu();
    this.renderMenu();
    this.show('menu');
  }

  pause() {
    if (this.game.state !== 'playing') return;
    this.game.pause();
    this.input.setEnabled(false);
    $('p-level').textContent = `Level ${this.game.levelNum}`;
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
    set('level', h.level, (v) => { $('h-level').textContent = `LV ${v}`; });
    set('prog', Math.round(h.progress * 200), (v) => { $('h-prog').style.setProperty('--p', v / 200); });
    set('coins', h.coins, (v) => { $('h-coins').innerHTML = coin(v); });
    set('kills', h.kills, (v) => { $('h-kills').textContent = `${v} kill${v === 1 ? '' : 's'}`; });
    set('hp', Math.ceil(h.hp) + '/' + h.maxHp, () => {
      $('h-hp').style.setProperty('--v', Math.max(0, h.hp) / h.maxHp);
      $('h-hp-n').textContent = Math.ceil(h.hp);
    });
    set('armor', Math.ceil(h.armor), (v) => {
      $('h-armor').style.setProperty('--v', v / h.maxArmor);
      $('h-armor-row').hidden = v <= 0;
      $('h-armor-n').textContent = v;
    });
    set('weapon', h.weapon, (v) => { $('h-wname').textContent = v; });
    set('ammo', h.reload === null ? `${h.ammo}` : 'reload', () => {
      $('h-ammo').textContent = h.reload === null ? h.ammo : '···';
      $('h-mag').textContent = `/ ${h.mag}`;
      $('h-weapon').classList.toggle('empty', h.reload === null && h.ammo === 0);
    });
    set('reload', h.reload === null ? -1 : Math.round(h.reload * 50), (v) => {
      $('h-weapon').classList.toggle('reloading', v >= 0);
      $('h-weapon').style.setProperty('--r', v < 0 ? 0 : v / 50);
    });
    set('next', h.next, (v) => {
      $('h-swap').hidden = !v;
      if (v) $('h-swap-n').textContent = v;
    });
    set('boss', h.boss === null ? -1 : Math.round(h.boss * 100), (v) => {
      $('h-boss').hidden = v < 0;
      $('h-boss').style.setProperty('--v', Math.max(0, v) / 100);
    });
    set('low', h.low, (v) => { $('vignette').classList.toggle('low', v); });
    const dbg = [h.god ? 'INVINCIBLE' : '', h.fps !== null ? `${h.fps} fps` : ''].filter(Boolean).join(' · ');
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
    $('r-title').textContent = r.won ? 'You made it' : 'Overrun';
    $('r-sub').textContent = r.won ? `Level ${r.level} cleared` : `Level ${r.level} · ${Math.round(r.time)}s in`;
    $('result').dataset.won = r.won;
    const rows = [
      ['Zombies down', fmt(r.kills)],
      ['Coins picked up', coin(r.coins)],
    ];
    if (r.won) rows.push(['Clear bonus', coin(r.bonus)]);
    rows.push(['Total', coin(r.total)]);
    $('r-stats').innerHTML = rows.map(([k, v], i) =>
      `<div class="row${i === rows.length - 1 ? ' total' : ''}"><span>${k}</span><b>${v}</b></div>`).join('');
    $('r-wallet').innerHTML = `Wallet: ${coin(save.coins)}`;
    $('r-next').textContent = r.won ? `Level ${r.level + 1}` : 'Try again';
    $('r-tip').textContent = r.won ? '' : this.tip();
    $('r-tip').hidden = r.won;
    $('result').hidden = false;
    this.current = 'result';
    $('hud').hidden = true;
  }

  tip() {
    const cheapest = this.cheapestUpgrade();
    if (cheapest && cheapest.cost <= save.coins) return `You can afford ${cheapest.label} in the Armory.`;
    const tips = [
      'Keep moving — zombies close in when you stand still.',
      'Back off while you reload. Walking never stops you shooting.',
      'Armor soaks most of a hit. Grab the blue vests.',
      'Runners have red eyes. Deal with them first.',
      'Coins you pick up are yours to keep, even if you fall.',
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  cheapestUpgrade() {
    let best = null;
    const consider = (cost, label) => { if (!best || cost < best.cost) best = { cost, label }; };
    WEAPONS.forEach((w, i) => {
      if (!save.owned.includes(w.id)) { consider(w.price, `the ${w.name}`); return; }
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
  openArmory(from) {
    this.armoryFrom = from;
    $('result').hidden = true;
    if (!save.owned.includes(this.selWeapon)) this.selWeapon = save.equipped;
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
      maxes.mag = Math.max(maxes.mag, s.mag);
    }
    const cards = WEAPONS.map((w) => {
      const owned = save.owned.includes(w.id);
      const tag = save.equipped === w.id ? 'Equipped' : owned ? 'Owned' : coin(w.price);
      return `<button class="wcard${owned ? ' owned' : ''}${w.id === this.selWeapon ? ' sel' : ''}${save.equipped === w.id ? ' eq' : ''}"
        data-act="sel" data-id="${w.id}" aria-pressed="${w.id === this.selWeapon}">
        ${gunIcon(w.id)}
        <span class="wn">${esc(w.name)}</span><span class="wt">${tag}</span></button>`;
    }).join('');

    const wi = WEAPONS.findIndex((w) => w.id === this.selWeapon);
    const w = WEAPONS[wi];
    const s = all[wi];
    const owned = save.owned.includes(w.id);
    const bar = (label, v, max, text) =>
      `<div class="stat"><span>${label}</span><i style="--v:${Math.min(1, v / max)}"></i><b>${text}</b></div>`;
    let html = `<div class="wgrid">${cards}</div>
      <div class="panel wdetail">
        <div class="wd-head"><h3>${esc(w.name)}</h3>${owned
          ? (save.equipped === w.id ? '<span class="pill">Equipped</span>' : `<button class="btn small" data-act="equip" data-id="${w.id}">Equip</button>`)
          : ''}</div>
        <p class="blurb">${esc(w.blurb)}</p>
        ${bar('Damage', s.damage * s.pellets, maxes.dmg, s.pellets > 1 ? `${Math.round(s.damage)}×${s.pellets}` : Math.round(s.damage))}
        ${bar('Fire rate', s.fireRate, maxes.rate, `${s.fireRate.toFixed(1)}/s`)}
        ${bar('Range', s.range, maxes.range, `${s.range} m`)}
        ${bar('Magazine', s.mag, maxes.mag, s.mag)}`;
    if (!owned) {
      const can = save.coins >= w.price;
      html += `<button class="btn primary wide" data-act="buy" data-id="${w.id}" ${can ? '' : 'aria-disabled="true"'}>
        Unlock for ${coin(w.price)}</button>`;
      if (!can) html += `<p class="need">${fmt(w.price - save.coins)} more coins needed</p>`;
    } else {
      html += '<h4>Upgrades</h4>';
      for (const [k, u] of Object.entries(WEAPON_UPGRADES)) {
        const lv = weaponUps(w.id)[k] || 0;
        html += this.upgradeRow(`w:${w.id}:${k}`, u.label, lv, u.max, lv < u.max ? weaponUpgradeCost(wi, k, lv) : null,
          `+${Math.round(u.step * 100)}% each`);
      }
    }
    return html + '</div>';
  }

  survivorHtml() {
    const st = playerStats(save.pup);
    const now = { maxHp: `${st.maxHp} HP`, speed: `${st.speed.toFixed(1)} m/s`, magnet: `${st.magnet.toFixed(1)} m` };
    let html = '<div class="panel"><p class="blurb">Upgrades that stay with you whichever gun you carry.</p>';
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
    } else if (act === 'equip') {
      save.equipped = b.dataset.id;
      sfx.swap();
    } else if (act === 'buy') {
      const w = WEAPONS.find((x) => x.id === b.dataset.id);
      if (save.coins < w.price) { sfx.denied(); this.nudge(b); return; }
      save.coins -= w.price;
      save.owned.push(w.id);
      save.equipped = w.id;
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
     hard" arrives with the level, gun, health and frame rate attached.     */
  noteContext() {
    const g = this.game;
    const fps = `${Math.round(g.fps)} fps`;
    if (!$('result').hidden && this.lastResult) {
      const r = this.lastResult;
      return `After level ${r.level} (${r.won ? 'cleared' : 'overrun'} in ${Math.round(r.time)}s, ${r.kills} kills) · ${this.loadoutText()} · ${fps}`;
    }
    if (g.run && ['playing', 'paused', 'dying', 'won'].includes(g.state)) {
      const p = g.player, h = g.hudState();
      return `Level ${g.levelNum} · ${g.weapon.stats.name} · ${Math.round(g.run.time)}s in · ` +
        `${Math.ceil(p.hp)}/${p.maxHp} HP${p.armor > 0 ? ` + ${Math.ceil(p.armor)} armor` : ''} · ` +
        `${g.run.kills} kills · ${Math.round(h.progress * 100)}% up the road · ${fps}`;
    }
    return `${this.current === 'armory' ? 'Armory' : 'Menu'} · ${this.loadoutText()} · ${fps}`;
  }

  loadoutText() {
    const ups = (id) => Object.values(weaponUps(id)).reduce((a, b) => a + b, 0);
    const guns = save.owned.map((id) => {
      const w = WEAPONS.find((x) => x.id === id);
      const n = ups(id);
      return w ? w.name + (n ? ` +${n}` : '') : id;
    });
    return `${save.coins} coins · guns: ${guns.join(', ')}`;
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
    this.toast(`Note saved (${notes.length} total)`);
  }

  notesText() {
    const when = (iso) => {
      try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
      catch { return iso; }
    };
    const head = `Graveway playtest notes\n${this.build || 'Web'} · screen ${window.innerWidth}×${window.innerHeight} · ${notes.length} note${notes.length === 1 ? '' : 's'}\n`;
    return head + notes.map((n, i) =>
      `\n${i + 1}. ${n.tags.length ? `[${n.tags.join(', ')}] ` : ''}${n.text || '(no comment)'}\n   ${n.ctx}\n   ${when(n.at)}`).join('\n');
  }

  openNotes() {
    this.clearArmed = false;
    $('ns-clear').textContent = 'Delete all';
    $('ns-clear').disabled = !notes.length;
    $('ns-copy').disabled = !notes.length;
    $('ns-text').value = notes.length ? this.notesText() : 'No notes yet. While playing, pause and tap "Leave a note".';
    $('ns-count').textContent = notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : '';
    $('notes').hidden = false;
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
    sw('t-god', s.god, s.god ? 'On' : 'Off');
    sw('t-fps', s.fps, s.fps ? 'On' : 'Off');
    $('s-notes-n').textContent = notes.length;
    $('s-version').textContent = `Graveway · ${this.build || 'Web'}`;
    $('s-reset').textContent = this.resetArmed ? 'Tap again to erase everything' : 'Reset progress';
    $('s-reset').classList.toggle('armed', this.resetArmed);
  }
}
