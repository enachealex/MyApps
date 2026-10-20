// The game: one endless run up the dead road. Ported from graveway/src/
// game.js, split across files by topic (Game.Zombies.cs, Game.Combat.cs).
// Game owns the camera, the lights and everything moving, and wires the
// parts together:
//   Road      (Road.cs)       streams the street in chunks
//   Director  (Director.cs)   spawns zombies by distance and time
//   Weapon    (Weapon.cs)     the guns in your hands
//   Hud       (Hud.cs)        everything on screen that isn't the world
//
// It builds itself: Boot() runs when any scene loads and makes one Game,
// so the scene can stay empty.

using System.Collections.Generic;
using UnityEngine;

namespace Graveway
{
    public sealed class Player
    {
        public float x, z, yaw, hp, maxHp, armor, speed, radius = Tunables.PlayerRadius;
        public float magnet, coinMult = 1, explosionResist;
        public List<Weapon> weapons = new List<Weapon>();
        public int wi;
        public float swapT, kick, walk, moving, hurtT, deadT, furthest;
        public bool reported;
        public Target target;
        public Weapon Weapon => weapons[wi];
    }

    public struct Target
    {
        public bool has;
        public float x, z;
        public Zombie zombie;
    }

    public sealed class RunStats
    {
        public int kills, bonus;
        public float coins, time, startZ;
        public Zombie boss;
    }

    public sealed partial class Game : MonoBehaviour
    {
        public enum State { Menu, Playing, Paused, Dying }

        // The survivor's gun sits at the right shoulder, where the camera
        // behind can see it past the head. Guns are drawn bigger than life.
        static readonly Vector3 GunMount = new Vector3(0.3f, 1.42f, 0.36f);
        const float GunScale = 1.7f;
        static readonly Color Fog = Hex.C(0x0d1418);

        public State state;
        public Rng rng = new Rng(7);
        public Road road;
        public Player player;
        public RunStats run;
        public readonly List<Zombie> zombies = new List<Zombie>();
        public float time;

        Director director;
        Hud hud;
        readonly StickInput input = new StickInput();
        Camera cam;
        Light flashlight, muzzleLight, blastLight;
        Transform worldRoot;
        CharacterDef character;
        Humanoid surv;
        readonly Dictionary<string, GameObject> guns = new Dictionary<string, GameObject>();
        float shake, flashT, blastT, blastPeak;
        Vector3 camPos = new Vector3(0, 12, -14), camLook;

        static bool booted;

        // With domain reload off (Enter Play Mode settings), statics live on
        // between Play presses; start each one clean.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => booted = false;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            if (booted) return;
            booted = true;
            var go = new GameObject("Graveway");
            DontDestroyOnLoad(go);
            go.AddComponent<Game>();
        }

        void Awake()
        {
            Application.targetFrameRate = 120;
            QualitySettings.vSyncCount = 0;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;
            Input.multiTouchEnabled = true;

            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = Fog;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Hex.C(0x8aa0c8) * 0.55f;
            RenderSettings.ambientEquatorColor = Hex.C(0x4a5260) * 0.5f;
            RenderSettings.ambientGroundColor = Hex.C(0x2a2018) * 0.5f;

            cam = new GameObject("Camera").AddComponent<Camera>();
            cam.transform.SetParent(transform);
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Fog;
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 90;
            cam.tag = "MainCamera";

            // Moonlight from above, the survivor's flashlight, and two lights
            // that only come on for muzzle flashes and explosions.
            var moon = new GameObject("Moon").AddComponent<Light>();
            moon.transform.SetParent(transform);
            moon.type = LightType.Directional;
            moon.color = Hex.C(0xb0c4ff);
            moon.intensity = 0.55f;
            moon.transform.rotation = Quaternion.LookRotation(new Vector3(8, -20, 6));
            moon.shadows = LightShadows.None;
            flashlight = MakeLight("Flashlight", LightType.Spot, Hex.C(0xfff0d0), 3.2f, 34);
            flashlight.spotAngle = 70;
            muzzleLight = MakeLight("Muzzle", LightType.Point, Hex.C(0xffc070), 0, 10);
            blastLight = MakeLight("Blast", LightType.Point, Hex.C(0xff9040), 0, 16);

            worldRoot = new GameObject("World").transform;
            worldRoot.SetParent(transform);
            director = new Director(this);
            hud = new GameObject("HUD").AddComponent<Hud>();
            hud.transform.SetParent(transform);
            hud.Init(this);
            input.overUi = hud.IsOverButton;
            InitCombat();
            ShowMenu();
        }

        Light MakeLight(string name, LightType type, Color c, float intensity, float range)
        {
            var l = new GameObject(name).AddComponent<Light>();
            l.transform.SetParent(transform);
            l.type = type;
            l.color = c;
            l.intensity = intensity;
            l.range = range;
            l.shadows = LightShadows.None;
            l.renderMode = LightRenderMode.ForcePixel;
            return l;
        }

        // ── Setup ───────────────────────────────────────────────────────
        void SetCharacter(string id)
        {
            character = Tunables.Character(id);
            if (surv != null) Destroy(surv.root);
            surv = Humanoid.Survivor(character);
            surv.root.transform.SetParent(transform, false);
            guns.Clear();
        }

        void ClearRun()
        {
            road?.Dispose();
            road = null;
            foreach (var z in zombies) Destroy(z.model.root);
            zombies.Clear();
            ClearCombat();
            run = null;
        }

        // The menu shows the first stretch of road with a few zombies about.
        public void ShowMenu()
        {
            ClearRun();
            state = State.Menu;
            rng = new Rng(7);
            SetCharacter(Save.Data.character);
            road = new Road(worldRoot, 7, 0);
            player = MakePlayer();
            player.z = 6;
            road.Update(player.z);
            for (int i = 0; i < 9; i++) SpawnZombie("walker", (rng.Next() - 0.5f) * 11, 12 + rng.Next() * 22, 0, calm: true);
            input.enabled = false;
            hud.ShowMenu();
            SyncSurvivor();
        }

        Player MakePlayer()
        {
            var c = character;
            var p = new Player
            {
                yaw = 0, maxHp = c.baseHealth, hp = c.baseHealth, speed = c.moveSpeed,
                armor = Mathf.Min(Tunables.MaxArmor, c.perk.startArmor), magnet = Tunables.PlayerMagnet + c.perk.magnetBonus,
                coinMult = c.perk.coinMult, explosionResist = c.perk.explosionResist,
            };
            // The survivor's own gun first, then the others they own (the
            // loadout and parts screens come with the Armory port).
            var ids = new List<string> { c.startingWeapon };
            foreach (var w in Tunables.Weapons)
                if (w.id != c.startingWeapon && Save.Data.owned.Contains(w.id) && ids.Count < Tunables.LoadoutSlots) ids.Add(w.id);
            foreach (var id in ids)
            {
                var w = new Weapon(id, null, c.perk);
                p.weapons.Add(w);
                if (!guns.ContainsKey(id)) guns[id] = MakeGun(w.def);
            }
            return p;
        }

        // A plain gun in the survivor's hands: receiver, grip and a light top
        // strip, at GunMount. (Fitted parts on the model come with the parts port.)
        GameObject MakeGun(WeaponDef d)
        {
            float len = d.id switch { "pistol" => 0.4f, "smg" => 0.5f, "shotgun" => 0.82f, "rifle" => 0.8f, "launcher" => 0.72f, _ => 0.86f };
            float w = d.id switch { "minigun" => 0.26f, "launcher" => 0.22f, _ => 0.14f };
            int color = d.id switch { "shotgun" => 0x8a5a36, "rifle" => 0x5c6a48, "launcher" => 0x6a7a40, _ => 0x585c66 };
            var g = new GameObject(d.id);
            g.transform.SetParent(surv.body, false);
            g.transform.localPosition = GunMount;
            g.transform.localScale = Vector3.one * GunScale;
            var mat = Art.Lit(Hex.C(color), 0.22f);
            surv.Attach(Art.Box(g.transform, new Vector3(w, 0.15f, len), new Vector3(0, 0, len / 2), mat, "receiver"));
            surv.Attach(Art.Box(g.transform, new Vector3(w * 0.8f, 0.18f, 0.1f), new Vector3(0, -0.12f, 0.08f), mat, "grip"));
            surv.Attach(Art.Box(g.transform, new Vector3(w * 0.4f, 0.03f, len * 0.85f), new Vector3(0, 0.09f, len * 0.48f), Art.Lit(Hex.C(0x8c929c), 0.12f), "rail"));
            g.SetActive(false);
            return g;
        }

        float GunLength(string id) => GunScale * (id switch { "pistol" => 0.4f, "smg" => 0.5f, "shotgun" => 0.82f, "rifle" => 0.8f, "launcher" => 0.72f, _ => 1.23f });

        public void StartRun()
        {
            ClearRun();
            SetCharacter(Save.Data.character);
            uint seed = (uint)(System.DateTime.Now.Ticks & 0xffff) ^ 0x5bd1u;
            rng = new Rng(seed);
            road = new Road(worldRoot, seed, 0);
            player = MakePlayer();
            run = new RunStats { startZ = 0 };
            director.Reset(0);
            road.Update(0);
            shake = 0;
            state = State.Playing;
            surv.body.localRotation = Quaternion.identity;
            surv.body.localPosition = Vector3.zero;
            camPos = new Vector3(0, 30, -30);
            input.enabled = true;
            hud.ShowHud();
            hud.Banner(character.name, "Get as far up the road as you can");
        }

        public float Distance => Mathf.Max(0, player.furthest - (run != null ? run.startZ : 0));
        public int Stage => Mathf.FloorToInt(Distance / Tunables.Director.StageLength);

        public void Pause() { if (state == State.Playing) { state = State.Paused; input.enabled = false; hud.ShowPause(); } }
        public void Resume() { if (state == State.Paused) { state = State.Playing; input.enabled = true; hud.ShowHud(); } }

        void OnApplicationPause(bool paused) { if (paused) Pause(); }

        // ── Frame ───────────────────────────────────────────────────────
        void Update()
        {
            float dt = Mathf.Min(Time.deltaTime, 1 / 20f);
            time += dt;
            input.Update();
            if (Input.GetKeyDown(KeyCode.Escape)) hud.Back();
            if (state == State.Playing) Keys();

            var p = player;
            if (road != null && state != State.Paused) road.Update(p.z);
            if (state == State.Playing)
            {
                run.time += dt;
                UpdatePlayer(dt, input.Move);
                director.Update(dt, Distance);
            }
            else if (state == State.Dying)
            {
                p.deadT += dt;
                float k = Mathf.Min(p.deadT / 0.6f, 1);
                surv.body.localRotation = Quaternion.Euler(-90 * k * k, 0, 0);
                surv.body.localPosition = new Vector3(0, 0.15f * k, 0);
                if (p.deadT > 1.6f && !p.reported) { p.reported = true; Finish(); }
            }
            if (state != State.Paused)
            {
                UpdateZombies(dt);
                UpdateBullets(dt);
                UpdateGrenades(dt);
            }
            UpdateCamera(dt);
            SyncSurvivor();
            UpdateLights(dt);
            if (state == State.Playing || state == State.Dying) hud.UpdateHud();
            hud.UpdateStick(input);
        }

        void Keys()
        {
            if (Input.GetKeyDown(KeyCode.R) || Input.GetKeyDown(KeyCode.Space)) Reload();
            if (Input.GetKeyDown(KeyCode.Q)) SwapWeapon(-1);
            if (Input.GetKeyDown(KeyCode.E) || Input.GetKeyDown(KeyCode.Tab)) SwapWeapon(1);
            if (Input.GetKeyDown(KeyCode.P)) Pause();
            for (int i = 0; i < 9; i++) if (Input.GetKeyDown(KeyCode.Alpha1 + i)) SelectWeapon(i);
        }

        // ── Player ──────────────────────────────────────────────────────
        static float Damp(float k, float dt) => 1 - Mathf.Exp(-k * dt);

        static float LerpAngle(float a, float b, float t)
        {
            float d = Mathf.Repeat(b - a + Mathf.PI, Mathf.PI * 2) - Mathf.PI;
            return a + d * t;
        }

        void UpdatePlayer(float dt, Vector3 mv)
        {
            var p = player;
            float len = mv.magnitude;
            p.moving = len;
            p.x += mv.x * p.speed * dt;
            p.z += mv.z * p.speed * dt;
            // Zombies are solid: a crowd blocks the road until you shoot a way
            // through or go round. Bigger ones shove you harder.
            foreach (var z in zombies)
            {
                if (z.dead) continue;
                float dx = p.x - z.x, dz = p.z - z.z, min = z.radius + p.radius;
                if (Mathf.Abs(dx) > min || Mathf.Abs(dz) > min) continue;
                float d = Mathf.Sqrt(dx * dx + dz * dz);
                if (d < min && d > 1e-4f)
                {
                    float share = z.scale > 1.2f ? 0.9f : 0.65f, push = min - d;
                    p.x += dx / d * push * share; p.z += dz / d * push * share;
                    z.x -= dx / d * push * (1 - share); z.z -= dz / d * push * (1 - share);
                }
            }
            p.x = Mathf.Clamp(p.x, -Road.WalkHalf, Road.WalkHalf);
            // No going back past the start barricade, or more than 20 m back
            // down the road (it's being torn down behind you).
            p.z = Mathf.Max(p.z, Mathf.Max(run.startZ - 4, p.furthest - 20));
            p.furthest = Mathf.Max(p.furthest, p.z);
            p.walk += len * dt * 11;

            var w = p.Weapon;
            p.target = ChooseTarget(w);
            float desired = p.yaw;
            if (p.target.has) desired = Mathf.Atan2(p.target.x - p.x, p.target.z - p.z);
            else if (len > 0.05f) desired = Mathf.Atan2(mv.x, mv.z);
            p.yaw = LerpAngle(p.yaw, desired, Damp(p.target.has ? 22 : 12, dt));

            p.kick = Mathf.Max(0, p.kick - dt * 9);
            if (p.swapT > 0) p.swapT -= dt;
            if (w.Tick(dt, p.target.has)) { /* reload done: sound comes with the audio port */ }
            if (p.target.has && w.CanFire && p.swapT <= 0)
            {
                float off = Mathf.Abs(LerpAngle(0, desired - p.yaw, 1));
                if (off < 0.3f) Fire(p.target);
            }
            if (p.hurtT > 0) p.hurtT -= dt;
        }

        // Auto-aim: the nearest zombie in range, preferring ones up the road
        // and the one already aimed at. (Props, cover and fog come later.)
        Target ChooseTarget(Weapon w)
        {
            var p = player;
            float range = w.stats.range, minRange = w.stats.minRange;
            Zombie best = null;
            float bestScore = float.PositiveInfinity;
            foreach (var z in zombies)
            {
                if (z.dead) continue;
                float dx = z.x - p.x, dz = z.z - p.z, d2 = dx * dx + dz * dz;
                if (d2 > range * range || d2 < minRange * minRange) continue;
                float d = Mathf.Sqrt(d2);
                // Building fronts stop bullets: no shots round corners.
                if (!w.Explosive && road.FacadeT(p.x, p.z, dx / d, dz / d, d) < d) continue;
                float score = d + (dz < -1 ? 4 : 0) + (p.target.zombie == z ? -1.5f : 0);
                if (score < bestScore) { bestScore = score; best = z; }
            }
            return best == null ? default : new Target { has = true, x = best.x, z = best.z, zombie = best };
        }

        public void Reload()
        {
            if (state != State.Playing) return;
            player.Weapon.StartReload();
        }

        public void SelectWeapon(int i)
        {
            var p = player;
            if (state != State.Playing || i == p.wi || i < 0 || i >= p.weapons.Count) return;
            p.Weapon.CancelReload();
            p.wi = i;
            p.swapT = 0.25f;
            if (p.Weapon.ammo <= 0) Reload();
        }

        public void SwapWeapon(int dir)
        {
            int n = player.weapons.Count;
            if (n > 1) SelectWeapon((player.wi + dir + n) % n);
        }

        public void HurtPlayer(float dmg, float fromX, float fromZ, bool blast = false)
        {
            var p = player;
            if (state != State.Playing) return;
            if (blast) dmg *= 1 - p.explosionResist;
            if (p.armor > 0)
            {
                float soak = Mathf.Min(p.armor, dmg * Tunables.ArmorAbsorb);
                p.armor -= soak;
                dmg -= soak;
            }
            p.hp -= dmg;
            p.hurtT = 0.35f;
            shake = Mathf.Max(shake, 0.35f);
            hud.FlashHurt();
            Blood(new Vector3(p.x, 1.3f, p.z), 6, 2.5f);
            float dx = p.x - fromX, dz = p.z - fromZ, l = Mathf.Max(0.001f, Mathf.Sqrt(dx * dx + dz * dz));
            p.x += dx / l * (blast ? 0.8f : 0.35f);
            p.z += dz / l * (blast ? 0.8f : 0.35f);
            if (p.hp <= 0)
            {
                p.hp = 0;
                state = State.Dying;
                p.deadT = 0;
                input.enabled = false;
            }
        }

        Vector3 Muzzle()
        {
            var p = player;
            float sin = Mathf.Sin(p.yaw), cos = Mathf.Cos(p.yaw);
            float reach = GunMount.z + GunLength(p.Weapon.Id), gx = GunMount.x;
            // body-local (x right, z forward) turned by the yaw
            return new Vector3(p.x + sin * reach + gx * cos, GunMount.y + 0.05f, p.z + cos * reach - gx * sin);
        }

        void SyncSurvivor()
        {
            var p = player;
            if (p == null || surv == null) return;
            surv.root.transform.position = new Vector3(p.x, 0, p.z);
            surv.root.transform.rotation = Quaternion.Euler(0, p.yaw * Mathf.Rad2Deg, 0);
            string id = p.Weapon.Id;
            foreach (var kv in guns)
            {
                if (kv.Value.activeSelf != (kv.Key == id)) kv.Value.SetActive(kv.Key == id);
            }
            if (guns.TryGetValue(id, out var gun)) gun.transform.localPosition = GunMount - new Vector3(0, 0, p.kick * 0.12f);
            float sw = Mathf.Sin(p.walk) * 0.7f * Mathf.Min(p.moving * 1.5f, 1) * Mathf.Rad2Deg;
            surv.legL.localRotation = Quaternion.Euler(sw, 0, 0);
            surv.legR.localRotation = Quaternion.Euler(-sw, 0, 0);
            if (state != State.Dying) surv.body.localPosition = new Vector3(0, Mathf.Abs(Mathf.Cos(p.walk)) * 0.06f * p.moving, 0);
            bool reloading = p.Weapon.Reloading;
            // Arms forward and a little down, so the hands meet the gun at the
            // right shoulder; the left one reaches across.
            float aim = (-90 + 7 + p.kick * 10 + (reloading ? 34 : 0));
            surv.armR.localRotation = Quaternion.Euler(0, -6, 0) * Quaternion.Euler(aim, 0, 0);
            surv.armL.localRotation = Quaternion.Euler(0, 28, 0) * Quaternion.Euler(aim + (reloading ? Mathf.Sin(time * 18) * 17 : 0), 0, 0);
        }

        // ── Camera and lights ────────────────────────────────────────────
        void UpdateCamera(float dt)
        {
            var p = player;
            if (p == null) return;
            bool portrait = Screen.height >= Screen.width;
            cam.fieldOfView = portrait ? 68 : 52;
            float tanH = Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad) * cam.aspect;
            float dist = Mathf.Clamp(5.8f / tanH, 13, 20), lookAhead = 4;
            if (state == State.Menu) { dist = 14; lookAhead = 3; p.yaw = 0; }
            RenderSettings.fogStartDistance = dist * 0.85f;
            RenderSettings.fogEndDistance = dist + 36;
            const float el = 0.92f;
            float tx = p.x * 0.55f, tz = p.z + lookAhead;
            camLook.x += (tx - camLook.x) * Damp(5, dt);
            camLook.z += (tz - camLook.z) * Damp(5, dt);
            camLook.y = 0.8f;
            var want = new Vector3(tx, Mathf.Sin(el) * dist, tz - Mathf.Cos(el) * dist - lookAhead * 0.4f);
            camPos = Vector3.Lerp(camPos, want, Damp(state == State.Playing ? 4.5f : 2, dt));
            var pos = camPos;
            if (shake > 0)
            {
                float s = shake * 0.35f;
                pos.x += (rng.Next() - 0.5f) * s;
                pos.y += (rng.Next() - 0.5f) * s;
                shake = Mathf.Max(0, shake - dt * 2.2f);
            }
            if (state == State.Menu) pos.x += Mathf.Sin(time * 0.15f) * 2;
            cam.transform.position = pos;
            cam.transform.LookAt(camLook);
        }

        void UpdateLights(float dt)
        {
            var p = player;
            float sin = Mathf.Sin(p.yaw), cos = Mathf.Cos(p.yaw);
            flashlight.transform.position = new Vector3(p.x + sin * 0.3f, 2.3f, p.z + cos * 0.3f);
            flashlight.transform.LookAt(new Vector3(p.x + sin * 9, 0, p.z + cos * 9));
            flashlight.enabled = state != State.Dying;
            if (flashT > 0) { flashT -= dt; if (flashT <= 0) { muzzleLight.intensity = 0; muzzleFlash.SetActive(false); } }
            if (blastT > 0)
            {
                blastT -= dt;
                float k = Mathf.Max(0, blastT / 0.3f);
                blastLight.intensity = blastPeak * k * k;
            }
        }

        // ── Stages and the end ───────────────────────────────────────────
        public void OnStage(int stage)
        {
            int bonus = Tunables.Director.StageBonus(stage);
            run.bonus += bonus;
            hud.Banner($"Stage {stage + 1}", $"{stage * Tunables.Director.StageLength:0} m · +{bonus} coins · they're getting tougher", 1.8f);
        }

        void Finish()
        {
            var r = run;
            var s = Save.Data;
            int distance = Mathf.FloorToInt(Distance), coins = Mathf.FloorToInt(r.coins);
            bool best = distance > s.best;
            s.coins += coins + r.bonus;
            s.kills += r.kills;
            s.runs++;
            s.best = Mathf.Max(s.best, distance);
            Save.Persist();
            hud.ShowResult(new Hud.Result
            {
                character = character.name, distance = distance, stage = Stage, kills = r.kills, coins = coins,
                bonus = r.bonus, time = r.time, best = best, wallet = s.coins, bestEver = s.best,
            });
        }

        // For the HUD
        public CharacterDef Character => character;
        public int AliveCount() { int n = 0; foreach (var z in zombies) if (!z.dead) n++; return n; }
    }
}
