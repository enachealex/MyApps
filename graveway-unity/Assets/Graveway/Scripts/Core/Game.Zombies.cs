// Zombies: spawning, wandering, chasing, attacking, dying. Ported from the
// zombie half of graveway/src/game.js. Pathing round props (the flow-field
// NavGrid) comes with the props port; for now they walk straight at you.

using UnityEngine;

namespace Graveway
{
    public sealed class Zombie
    {
        public enum Mode { Idle, Chase, Attack }

        public ZombieKind kind;
        public Humanoid model;
        public float x, z, yaw, scale, hp, maxHp, speed, damage, radius;
        public int stage;
        public Mode mode;
        public float attackT, wanderT, wx, wz, kx, kz, flash, phase, deadT, lean, headTilt;
        public bool hitDone, dead, calm, emerging;
        public float flyY, flyVy, flySx, flySz;
        public bool flying;
    }

    public sealed partial class Game
    {
        public Zombie SpawnZombie(string kindId, float x, float z, int stage, bool calm = false, Alley alley = null, bool chase = false)
        {
            var k = Tunables.Zombies[kindId];
            var sc = Tunables.StageScaling(stage);
            var model = Humanoid.Zombie(k, rng);
            float scale = k.scale * (kindId == "walker" ? 0.92f + rng.Next() * 0.16f : 1);
            model.root.transform.SetParent(worldRoot, false);
            model.root.transform.localScale = Vector3.one * scale;
            float hp = k.hp * sc.hp;
            var zb = new Zombie
            {
                kind = k, model = model, x = x, z = z, yaw = Mathf.PI * (rng.Next() * 2 - 1), scale = scale, stage = stage,
                hp = hp, maxHp = hp, speed = (k.speedMin + rng.Next() * (k.speedMax - k.speedMin)) * sc.speed,
                damage = k.damage * sc.damage, radius = k.radius * (scale / k.scale),
                mode = chase ? Zombie.Mode.Chase : Zombie.Mode.Idle, calm = calm, emerging = alley != null,
                phase = rng.Next() * 10, lean = 0.1f + rng.Next() * 0.25f, headTilt = (rng.Next() - 0.5f) * 0.6f,
            };
            zombies.Add(zb);
            return zb;
        }

        // Called by the Director.
        public void SpawnGroup(int count, int stage, float z = 0, Alley alley = null, bool behind = false)
        {
            int room = Tunables.Director.MaxActive(stage) - AliveCount();
            int n = Mathf.Min(count, room);
            for (int i = 0; i < n; i++)
            {
                string kind = director.PickKind(stage);
                if (alley != null)
                    SpawnZombie(kind, alley.x + alley.side * rng.Next() * 2.5f, alley.z + (rng.Next() - 0.5f) * 2, stage, alley: alley, chase: true);
                else
                    SpawnZombie(kind, (rng.Next() - 0.5f) * 12.5f, z + (rng.Next() - 0.5f) * 8, stage, chase: behind);
            }
            if (alley != null && n >= 3) hud.Banner("Ambush!", null, 1.2f);
        }

        public void SpawnBoss()
        {
            run.boss = SpawnZombie("boss", 0, player.z + 38, Stage, chase: true);
            hud.Banner("Something big is coming", "Put it down for a fat reward");
        }

        void UpdateZombies(float dt)
        {
            var p = player;
            bool playing = state == State.Playing;
            for (int i = zombies.Count - 1; i >= 0; i--)
            {
                var z = zombies[i];
                var m = z.model;
                var tr = m.root.transform;
                if (z.dead)
                {
                    z.deadT += dt;
                    float k = Mathf.Min(z.deadT / 0.45f, 1);
                    m.body.localRotation = Quaternion.Euler(-90 * k * k, 0, 0);
                    m.body.localPosition = new Vector3(0, 0.12f * k, 0);
                    var armX = Quaternion.Euler(-90 - k * 34, 0, 0);
                    m.armL.localRotation = armX; m.armR.localRotation = armX;
                    z.x += z.kx * dt; z.z += z.kz * dt;
                    float y = 0;
                    if (z.flying)
                    {
                        // thrown by a blast: up, tumbling, down
                        z.flyVy -= 20 * dt;
                        z.flyY += z.flyVy * dt;
                        tr.rotation *= Quaternion.Euler(z.flySx * dt * Mathf.Rad2Deg, 0, z.flySz * dt * Mathf.Rad2Deg);
                        if (z.flyY <= 0 && z.flyVy < 0) { z.flying = false; tr.rotation = Quaternion.Euler(0, z.yaw * Mathf.Rad2Deg, 0); }
                        y = Mathf.Max(0, z.flyY);
                    }
                    else { z.kx *= 1 - Damp(6, dt); z.kz *= 1 - Damp(6, dt); }
                    if (z.deadT > 3) y -= (z.deadT - 3) * 0.5f;
                    tr.position = new Vector3(z.x, y, z.z);
                    if (z.deadT > 4.5f) { Destroy(m.root); zombies.RemoveAt(i); }
                    continue;
                }
                // Far behind the survivor, off the built road: gone. A boss
                // gets more rope, but one you've outrun is gone too.
                bool isBoss = run != null && z == run.boss;
                if (z.z < p.z - (isBoss ? 60 : 45))
                {
                    if (isBoss) run.boss = null;
                    Destroy(m.root);
                    zombies.RemoveAt(i);
                    continue;
                }

                float dx = p.x - z.x, dz = p.z - z.z, dist = Mathf.Max(1e-4f, Mathf.Sqrt(dx * dx + dz * dz));
                float vx = 0, vz = 0;
                float? faceYaw = null;
                if (z.mode == Zombie.Mode.Idle)
                {
                    z.wanderT -= dt;
                    if (z.wanderT <= 0)
                    {
                        z.wanderT = 1.5f + rng.Next() * 3;
                        float a = rng.Next() * Mathf.PI * 2;
                        bool go = rng.Next() < 0.7f;
                        z.wx = go ? Mathf.Sin(a) : 0; z.wz = go ? Mathf.Cos(a) : 0;
                    }
                    vx = z.wx * z.speed * 0.35f; vz = z.wz * z.speed * 0.35f;
                    if (vx != 0 || vz != 0) faceYaw = Mathf.Atan2(vx, vz);
                    if (playing && dist < z.kind.aggro) z.mode = Zombie.Mode.Chase;
                }
                else if (z.mode == Zombie.Mode.Chase)
                {
                    if (!playing) z.mode = Zombie.Mode.Idle;
                    else
                    {
                        float reach = z.kind.reach * (z.scale / z.kind.scale) + p.radius;
                        if (dist < reach) { z.mode = Zombie.Mode.Attack; z.attackT = 0; z.hitDone = false; }
                        vx = dx / dist * z.speed; vz = dz / dist * z.speed;
                        faceYaw = Mathf.Atan2(vx, vz);
                    }
                }
                else
                {
                    z.attackT += dt;
                    faceYaw = Mathf.Atan2(dx, dz);
                    float period = 1 / z.kind.attackRate, windup = Mathf.Min(0.42f, period * 0.5f);
                    if (!z.hitDone && z.attackT >= windup)
                    {
                        z.hitDone = true;
                        float reach = z.kind.reach * (z.scale / z.kind.scale) + p.radius + 0.35f;
                        if (dist < reach && playing)
                        {
                            if (z.kind.id == "boss") shake = Mathf.Max(shake, 0.6f);
                            HurtPlayer(z.damage, z.x, z.z);
                        }
                    }
                    if (z.attackT >= period) z.mode = playing ? Zombie.Mode.Chase : Zombie.Mode.Idle;
                }

                // Keep zombies from piling into one spot.
                foreach (var o in zombies)
                {
                    if (o == z || o.dead) continue;
                    float ox = z.x - o.x, oz = z.z - o.z, min = z.radius + o.radius;
                    if (Mathf.Abs(ox) > min || Mathf.Abs(oz) > min) continue;
                    float d2 = ox * ox + oz * oz;
                    if (d2 < min * min && d2 > 1e-6f)
                    {
                        float d = Mathf.Sqrt(d2), push = (min - d) * 0.5f;
                        z.x += ox / d * push; z.z += oz / d * push;
                    }
                }

                z.x += (vx + z.kx) * dt;
                z.z += (vz + z.kz) * dt;
                z.kx *= 1 - Damp(9, dt); z.kz *= 1 - Damp(9, dt);
                if (z.emerging) { if (Mathf.Abs(z.x) < Road.WalkHalf - 0.3f) z.emerging = false; }
                else z.x = Mathf.Clamp(z.x, -Road.WalkHalf, Road.WalkHalf);
                if (run != null && z.z < run.startZ - 4.5f) z.z = run.startZ - 4.5f;
                // Zombies can't walk through the survivor (the survivor's side
                // of this is in UpdatePlayer).
                if (playing && dist < z.radius + p.radius)
                {
                    float push = (z.radius + p.radius - dist) * 0.5f;
                    z.x -= dx / dist * push; z.z -= dz / dist * push;
                }
                if (faceYaw.HasValue) z.yaw = LerpAngle(z.yaw, faceYaw.Value, Damp(z.mode == Zombie.Mode.Idle ? 3 : 8, dt));

                // Animation: legs shuffle, arms reach, heavier lurch for big ones.
                float moveSpeed = Mathf.Sqrt(vx * vx + vz * vz);
                z.phase += dt * (1.2f + moveSpeed * 2.2f) / (z.scale / z.kind.scale);
                float sw = Mathf.Sin(z.phase) * Mathf.Min(0.15f + moveSpeed * 0.18f, 0.75f) * Mathf.Rad2Deg;
                m.legL.localRotation = Quaternion.Euler(sw, 0, 0);
                m.legR.localRotation = Quaternion.Euler(-sw, 0, 0);
                m.body.localRotation = Quaternion.Euler((z.lean + (z.kind.id == "runner" ? 0.25f : 0)) * Mathf.Rad2Deg, 0, Mathf.Sin(z.phase * 0.5f) * 3.4f);
                m.body.localPosition = new Vector3(0, Mathf.Abs(Mathf.Cos(z.phase)) * 0.05f, 0);
                m.head.localRotation = Quaternion.Euler(0, 0, (z.headTilt + Mathf.Sin(z.phase * 0.7f) * 0.1f) * Mathf.Rad2Deg);
                float arm = -90 + 14 + Mathf.Sin(z.phase * 1.3f) * 7;
                if (z.mode == Zombie.Mode.Attack)
                {
                    float k = z.attackT / Mathf.Min(0.42f, 0.5f / z.kind.attackRate);
                    arm = k < 1 ? -90 - 52 * k : -90 + 29;
                }
                m.armL.localRotation = Quaternion.Euler(arm, 0, 0);
                m.armR.localRotation = Quaternion.Euler(arm + Mathf.Sin(z.phase) * 8.6f, 0, 0);

                if (z.flash > 0) { z.flash -= dt; if (z.flash <= 0) m.SetFlash(false); }
                tr.position = new Vector3(z.x, 0, z.z);
                tr.rotation = Quaternion.Euler(0, z.yaw * Mathf.Rad2Deg, 0);
            }
        }

        public void DamageZombie(Zombie z, float dmg, float dx, float dz, float knock, float launch = 0)
        {
            if (z.dead) return;
            z.hp -= dmg;
            if (z.mode == Zombie.Mode.Idle) z.mode = Zombie.Mode.Chase;
            float k = knock / (z.scale * z.scale);
            z.kx += dx * k * 2.2f; z.kz += dz * k * 2.2f;
            z.model.SetFlash(true);
            z.flash = 0.07f;
            Blood(new Vector3(z.x, 1.2f * z.scale, z.z), 3, 2.5f);
            if (z.hp <= 0) KillZombie(z, dx, dz, launch);
        }

        void KillZombie(Zombie z, float dx, float dz, float launch = 0)
        {
            z.dead = true;
            z.deadT = 0;
            if (launch > 0.5f)
            {
                z.flying = true; z.flyY = 0; z.flyVy = launch;
                z.flySx = (rng.Next() - 0.5f) * 10; z.flySz = (rng.Next() - 0.5f) * 10;
            }
            z.yaw = Mathf.Atan2(-dx, -dz);                // fall away from the shot
            z.model.root.transform.rotation = Quaternion.Euler(0, z.yaw * Mathf.Rad2Deg, 0);
            z.model.SetFlash(false);
            z.flash = 0;
            Blood(new Vector3(z.x, 1.1f * z.scale, z.z), (int)(10 + z.scale * 6), 3.5f * z.scale);
            if (run == null) return;
            run.kills++;
            // Coins straight into the run's purse for now; dropped coins you
            // pick up (with the magnet) come with the pickups port.
            run.coins += (z.kind.coins + (rng.Next() < 0.3f ? 1 : 0)) * player.coinMult;
            if (z.kind.id == "boss")
            {
                shake = 0.8f;
                hud.Banner("Boss down!", $"+{z.kind.coins} coins");
            }
        }
    }
}
