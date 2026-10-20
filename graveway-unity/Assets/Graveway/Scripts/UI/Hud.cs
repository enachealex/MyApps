// Everything on screen that isn't the world: the in-run HUD, the menu, the
// pause card and the end-of-run card. UI Toolkit, built in code and styled
// by Resources/UI/Graveway.uss (the port of graveway/index.html's CSS).
//
// Only buttons can be touched; everything else ignores the pointer, so a
// touch anywhere else steers (see StickInput.overUi). In-run buttons act
// the moment a finger lands on them, so they work while the other thumb is
// steering.

using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Graveway
{
    public sealed class Hud : MonoBehaviour
    {
        public struct Result
        {
            public string character;
            public int distance, stage, kills, coins, bonus, wallet, bestEver;
            public float time;
            public bool best;
        }

        Game game;
        UIDocument doc;
        VisualElement root, hud, menu, pause, result, banner, vignette, stickBase, stickKnob, wbar, weaponCard;
        Label dist, stageLabel, coins, kills, hpText, armorText, wname, ammo, mag, bannerT, bannerS;
        Label menuBest, menuRuns, menuName, menuRole, menuPerk, pauseLevel;
        Label rTitle, rDist, rSub, rStats, rWallet;
        VisualElement prog, hpFill, armorFill, armorRow, reloadFill, bossRow, bossFill;
        float bannerT0, hurtT;
        readonly Dictionary<string, string> last = new Dictionary<string, string>();

        public void Init(Game g)
        {
            game = g;
            var settings = ScriptableObject.CreateInstance<PanelSettings>();
            settings.themeStyleSheet = Resources.Load<ThemeStyleSheet>("UI/GravewayTheme");
            settings.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            settings.referenceResolution = new Vector2Int(390, 844);
            settings.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            settings.match = 0.5f;

            var go = new GameObject("UI Document");
            go.SetActive(false);
            go.transform.SetParent(transform, false);
            doc = go.AddComponent<UIDocument>();
            doc.panelSettings = settings;
            go.SetActive(true);

            root = doc.rootVisualElement;
            root.pickingMode = PickingMode.Ignore;
            var sheet = Resources.Load<StyleSheet>("UI/Graveway");
            if (sheet != null) root.styleSheets.Add(sheet);
            root.AddToClassList("gw-root");
            Build();
        }

        // ── Building blocks ─────────────────────────────────────────────
        static T Ignore<T>(T ve) where T : VisualElement { ve.pickingMode = PickingMode.Ignore; return ve; }
        static VisualElement Box(string cls, VisualElement parent)
        {
            var v = Ignore(new VisualElement());
            foreach (var c in cls.Split(' ')) if (c.Length > 0) v.AddToClassList(c);
            parent?.Add(v);
            return v;
        }
        static Label Text(string cls, VisualElement parent, string text = "")
        {
            var l = Ignore(new Label(text));
            foreach (var c in cls.Split(' ')) if (c.Length > 0) l.AddToClassList(c);
            parent.Add(l);
            return l;
        }
        // A menu button: acts on release, like any button.
        static Button Btn(string text, string cls, VisualElement parent, Action onClick)
        {
            var b = new Button(onClick) { text = text };
            b.AddToClassList("btn");
            foreach (var c in cls.Split(' ')) if (c.Length > 0) b.AddToClassList(c);
            parent.Add(b);
            return b;
        }
        // An in-run button: acts the moment a finger touches it.
        static VisualElement Press(string cls, VisualElement parent, Action onPress)
        {
            var v = new VisualElement();
            foreach (var c in cls.Split(' ')) if (c.Length > 0) v.AddToClassList(c);
            v.RegisterCallback<PointerDownEvent>(e => { onPress(); e.StopPropagation(); });
            parent.Add(v);
            return v;
        }
        static VisualElement Bar(string cls, VisualElement parent, out VisualElement fill)
        {
            var bar = Box("bar " + cls, parent);
            fill = Box("bar-fill", bar);
            return bar;
        }

        void Build()
        {
            vignette = Box("vignette", root);

            // In-run HUD
            hud = Box("hud", root);
            var top = Box("h-top", hud);
            dist = Text("chip h-dist", top, "0 M");
            var stage = Box("h-stage", top);
            stageLabel = Text("h-stage-label", stage, "STAGE 1");
            Bar("h-prog", stage, out prog);
            coins = Text("chip h-coins", top, "0");
            var pauseBtn = Press("icon-btn h-pause", top, () => game.Pause());
            Text("icon-text", pauseBtn, "II");
            kills = Text("h-kills", hud, "0 kills");
            bossRow = Box("h-boss", hud);
            Text("h-boss-label", bossRow, "BOSS");
            Bar("h-boss-bar", bossRow, out bossFill);

            var bottom = Box("h-bottom", hud);
            var vitals = Box("vitals", bottom);
            armorRow = Box("vital-row", vitals);
            Bar("armor", armorRow, out armorFill);
            armorText = Text("vital-n", armorRow, "0");
            var hpRow = Box("vital-row", vitals);
            Bar("hp", hpRow, out hpFill);
            hpText = Text("vital-n", hpRow, "100");
            var weap = Box("weap", bottom);
            wbar = Box("wbar", weap);
            weaponCard = Press("weapon-card", weap, () => game.Reload());
            wname = Text("wname", weaponCard, "PISTOL");
            var ammoRow = Box("ammo-row", weaponCard);
            ammo = Text("ammo", ammoRow, "12");
            mag = Text("mag", ammoRow, "/ 12");
            Text("tap", weaponCard, "TAP TO RELOAD");
            reloadFill = Box("reload-fill", weaponCard);

            stickBase = Box("stick-base", root);
            stickKnob = Box("stick-knob", stickBase);

            banner = Box("banner", root);
            bannerT = Text("banner-t", banner);
            bannerS = Text("banner-s", banner);

            // Menu
            menu = Box("screen menu", root);
            var title = Box("title", menu);
            Text("title-main", title, "GRAVEWAY");
            Text("title-sub", title, "Walk the dead road. Get as far as you can.");
            var mb = Box("menu-bottom", menu);
            var pick = Box("pick", mb);
            pick.pickingMode = PickingMode.Position;
            Btn("‹", "arrow", pick, () => Cycle(-1));
            var who = Box("who", pick);
            menuName = Text("who-name", who);
            menuRole = Text("who-role", who);
            menuPerk = Text("who-perk", who);
            Btn("›", "arrow", pick, () => Cycle(1));
            var stats = Box("menu-stats", mb);
            menuBest = Text("menu-best", stats);
            menuRuns = Text("menu-runs", stats);
            Btn("PLAY", "primary big", mb, () => game.StartRun());
            Text("hint", mb, "Drag anywhere to move. Aiming and shooting are automatic.");

            // Pause
            pause = Box("modal", root);
            pause.pickingMode = PickingMode.Position;
            var pc = Box("card", pause);
            Text("card-title", pc, "PAUSED");
            pauseLevel = Text("card-sub", pc);
            Btn("RESUME", "primary big", pc, () => game.Resume());
            Btn("QUIT", "", pc, () => game.ShowMenu());

            // End of a run
            result = Box("modal", root);
            result.pickingMode = PickingMode.Position;
            var rc = Box("card", result);
            rTitle = Text("card-title red", rc, "OVERRUN");
            rDist = Text("r-dist", rc);
            rSub = Text("card-sub", rc);
            rStats = Text("r-stats", rc);
            rWallet = Text("r-wallet", rc);
            Btn("RUN AGAIN", "primary big", rc, () => game.StartRun());
            Btn("MENU", "", rc, () => game.ShowMenu());
        }

        // ── Screens ─────────────────────────────────────────────────────
        void Only(VisualElement show)
        {
            foreach (var v in new[] { hud, menu, pause, result }) v.style.display = v == show || (v == hud && show == pause) ? DisplayStyle.Flex : DisplayStyle.None;
        }

        public void ShowMenu()
        {
            Only(menu);
            banner.style.display = DisplayStyle.None;
            var s = Save.Data;
            var c = Tunables.Character(s.character);
            menuName.text = c.name.ToUpperInvariant();
            menuRole.text = c.role;
            menuPerk.text = $"{c.perk.name}: {c.perk.text} · brings the {Tunables.Weapon(c.startingWeapon).name}";
            menuBest.text = s.best > 0 ? $"Best run {s.best:N0} m" : "No runs yet";
            menuRuns.text = s.runs > 0 ? $"{s.runs} run{(s.runs == 1 ? "" : "s")} · {s.kills:N0} kills · {s.coins:N0} coins" : "";
        }

        void Cycle(int d)
        {
            var list = Tunables.Characters;
            int i = Array.FindIndex(list, c => c.id == Save.Data.character);
            Save.Data.character = list[((i < 0 ? 0 : i) + d + list.Length) % list.Length].id;
            Save.Persist();
            game.ShowMenu();
        }

        public void ShowHud()
        {
            Only(hud);
            last.Clear();
            BuildWeaponBar();
        }

        public void ShowPause()
        {
            pauseLevel.text = $"{game.Distance:N0} m · stage {game.Stage + 1}";
            Only(pause);
        }

        public void ShowResult(Result r)
        {
            rDist.text = $"{r.distance:N0} M";
            rSub.text = r.best ? "NEW BEST!" : $"Stage {r.stage + 1} · {Mathf.Round(r.time)}s · {r.character}";
            rStats.text = $"Zombies down  {r.kills:N0}\nCoins picked up  {r.coins:N0}\nStage bonuses  {r.bonus:N0}\nTotal  {r.coins + r.bonus:N0}";
            rWallet.text = $"Wallet: {r.wallet:N0} · Best: {r.bestEver:N0} m";
            Only(result);
        }

        // Android back button and Escape: close what's on top, pause a run,
        // and only leave the app from the menu.
        public void Back()
        {
            if (result.style.display == DisplayStyle.Flex) { game.ShowMenu(); return; }
            switch (game.state)
            {
                case Game.State.Playing: game.Pause(); break;
                case Game.State.Paused: game.Resume(); break;
                case Game.State.Menu: Application.Quit(); break;
            }
        }

        public void Banner(string title, string sub, float seconds = 2.2f)
        {
            bannerT.text = title.ToUpperInvariant();
            bannerS.text = sub ?? "";
            bannerS.style.display = string.IsNullOrEmpty(sub) ? DisplayStyle.None : DisplayStyle.Flex;
            banner.style.display = DisplayStyle.Flex;
            bannerT0 = Time.time + seconds;
        }

        public void FlashHurt() => hurtT = 0.45f;

        void BuildWeaponBar()
        {
            wbar.Clear();
            var ws = game.player.weapons;
            if (ws.Count < 2) return;
            for (int i = 0; i < ws.Count; i++)
            {
                int k = i;
                var b = Press("wbtn", wbar, () => game.SelectWeapon(k));
                Text("wbtn-n", b, (i + 1).ToString());
                Text("wbtn-name", b, ws[i].Name.ToUpperInvariant());
                Box("wbtn-ammo", b);
            }
        }

        // ── Every frame ─────────────────────────────────────────────────
        bool Changed(string key, string val)
        {
            if (last.TryGetValue(key, out var old) && old == val) return false;
            last[key] = val;
            return true;
        }

        static void Fill(VisualElement fill, float v) => fill.style.width = Length.Percent(Mathf.Clamp01(v) * 100);

        public void UpdateHud()
        {
            var p = game.player;
            var r = game.run;
            if (p == null || r == null) return;
            int d = Mathf.FloorToInt(game.Distance);
            if (Changed("dist", d.ToString())) dist.text = $"{d:N0} M";
            if (Changed("stage", game.Stage.ToString())) stageLabel.text = $"STAGE {game.Stage + 1}";
            Fill(prog, game.Distance % Tunables.Director.StageLength / Tunables.Director.StageLength);
            int c = Save.Data.coins + Mathf.FloorToInt(r.coins) + r.bonus;
            if (Changed("coins", c.ToString())) coins.text = c.ToString("N0");
            if (Changed("kills", r.kills.ToString())) kills.text = $"{r.kills} kill{(r.kills == 1 ? "" : "s")}";
            int hp = Mathf.CeilToInt(p.hp);
            if (Changed("hp", hp + "/" + p.maxHp)) { hpText.text = hp.ToString(); Fill(hpFill, p.hp / p.maxHp); }
            int ar = Mathf.CeilToInt(p.armor);
            if (Changed("armor", ar.ToString()))
            {
                armorRow.style.display = ar > 0 ? DisplayStyle.Flex : DisplayStyle.None;
                armorText.text = ar.ToString();
                Fill(armorFill, p.armor / Tunables.MaxArmor);
            }
            var w = p.Weapon;
            if (Changed("wname", w.Name)) wname.text = w.Name.ToUpperInvariant();
            string a = w.Reloading ? "···" : w.ammo.ToString();
            if (Changed("ammo", a + "/" + w.stats.ammoCapacity))
            {
                ammo.text = a;
                mag.text = $"/ {w.stats.ammoCapacity}";
                weaponCard.EnableInClassList("empty", !w.Reloading && w.ammo == 0);
                weaponCard.EnableInClassList("reloading", w.Reloading);
            }
            Fill(reloadFill, w.Reloading ? w.ReloadProgress : 0);
            for (int i = 0; i < wbar.childCount && i < p.weapons.Count; i++)
            {
                var b = wbar[i];
                b.EnableInClassList("on", i == p.wi);
                var ww = p.weapons[i];
                Fill(b[2], ww.Reloading ? 0 : ww.ammo / (float)ww.stats.ammoCapacity);
            }
            bool boss = r.boss != null && !r.boss.dead;
            bossRow.style.display = boss ? DisplayStyle.Flex : DisplayStyle.None;
            if (boss) Fill(bossFill, r.boss.hp / r.boss.maxHp);
        }

        void Update()
        {
            if (banner.style.display == DisplayStyle.Flex && Time.time > bannerT0) banner.style.display = DisplayStyle.None;
            // Red flash when hurt; a slow pulse when health is low.
            hurtT = Mathf.Max(0, hurtT - Time.deltaTime);
            var p = game.player;
            bool low = game.state == Game.State.Playing && p != null && p.hp / p.maxHp < 0.3f;
            float pulse = low ? 0.25f + 0.35f * (0.5f + 0.5f * Mathf.Sin(Time.time * 5.7f)) : 0;
            vignette.style.opacity = Mathf.Max(hurtT / 0.45f, pulse);
            SafeArea();
        }

        // Keep the HUD clear of notches and the gesture bar.
        Rect lastSafe;
        void SafeArea()
        {
            var s = Screen.safeArea;
            if (s == lastSafe || root.panel == null) return;
            lastSafe = s;
            var topLeft = RuntimePanelUtils.ScreenToPanel(root.panel, new Vector2(s.xMin, Screen.height - s.yMax));
            var bottomRight = RuntimePanelUtils.ScreenToPanel(root.panel, new Vector2(s.xMax, Screen.height - s.yMin));
            var size = root.layout.size;
            root.style.paddingTop = topLeft.y;
            root.style.paddingLeft = topLeft.x;
            if (size.x > 0) root.style.paddingRight = Mathf.Max(0, size.x - bottomRight.x);
            if (size.y > 0) root.style.paddingBottom = Mathf.Max(0, size.y - bottomRight.y);
        }

        // The joystick appears under your thumb.
        public void UpdateStick(StickInput input)
        {
            if (root.panel == null) return;
            bool on = input.Active && game.state == Game.State.Playing;
            stickBase.style.display = on ? DisplayStyle.Flex : DisplayStyle.None;
            if (!on) return;
            var o = RuntimePanelUtils.ScreenToPanel(root.panel, new Vector2(input.Origin.x, Screen.height - input.Origin.y));
            var edge = RuntimePanelUtils.ScreenToPanel(root.panel, new Vector2(input.Origin.x + input.Radius, Screen.height - input.Origin.y));
            float r = Mathf.Max(20, edge.x - o.x), scale = r / input.Radius;
            stickBase.style.left = o.x - r;
            stickBase.style.top = o.y - r;
            stickBase.style.width = r * 2;
            stickBase.style.height = r * 2;
            float knob = r * 0.45f;
            stickKnob.style.width = knob * 2;
            stickKnob.style.height = knob * 2;
            stickKnob.style.left = r - knob + input.Knob.x * scale;
            stickKnob.style.top = r - knob - input.Knob.y * scale;
        }

        // Is this screen point (pixels, origin bottom-left) on something
        // touchable? Then a touch there doesn't steer.
        public bool IsOverButton(Vector2 screen)
        {
            var panel = root?.panel;
            if (panel == null) return false;
            var pp = RuntimePanelUtils.ScreenToPanel(panel, new Vector2(screen.x, Screen.height - screen.y));
            return panel.Pick(pp) != null;
        }
    }
}
