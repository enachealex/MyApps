// Firing, bullets, grenades and explosions, ported from graveway/src/
// game.js. Bullets are swept along their path each frame so fast ones never
// skip a zombie. Props stopping bullets and blasts wrecking the street come
// with the props port; here bullets stop at building fronts.

using System.Collections.Generic;
using UnityEngine;

namespace Graveway
{
    public sealed partial class Game
    {
        const int MaxBullets = 260, MaxGrenades = 24;
        const float Gravity = 20;

        sealed class Bullet
        {
            public float x, z, dx, dz, speed, life, damage, knock;
            public int pierce;
            public List<Zombie> hits;
            public GameObject view;
        }

        sealed class Grenade
        {
            public float x, y, z, sx, sz, vx, vy, vz, life, damage, spin;
            public Blast blast;
            public GameObject view;
        }

        readonly List<Bullet> bullets = new List<Bullet>();
        readonly Stack<GameObject> bulletPool = new Stack<GameObject>();
        readonly List<Grenade> grenades = new List<Grenade>();
        readonly Stack<GameObject> grenadePool = new Stack<GameObject>();
        GameObject muzzleFlash;
        ParticleSystem blood, fire, smoke;
        Material tracerMat, shellMat;

        void InitCombat()
        {
            tracerMat = Art.Unlit(Hex.C(0xffe2a0));
            shellMat = Art.Lit(Hex.C(0x4a5a2a), 0.2f);
            muzzleFlash = Art.Part(transform, Art.Quad, Art.Glow(Hex.C(0xffd080)), Vector3.zero, Vector3.one, "muzzle flash");
            muzzleFlash.SetActive(false);
            blood = MakeBurst("blood", Art.Unlit(Hex.C(0x6e0b0b)), true, 1.4f);
            fire = MakeBurst("fire", Art.Glow(Hex.C(0xff8a24)), false, -0.2f);
            smoke = MakeBurst("smoke", Art.Glow(Hex.C(0x3a3632)), false, -0.05f);
        }

        // A particle system that only emits when told to (Emit). It's left
        // playing with its own emission off, because a stopped system doesn't
        // move the particles it's given. Blood is little cubes that fall and
        // bounce off the road; fire and smoke are soft camera-facing puffs.
        ParticleSystem MakeBurst(string name, Material mat, bool cubes, float gravity)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = true;
            main.playOnAwake = false;
            main.maxParticles = 900;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.gravityModifier = gravity;
            main.startLifetime = cubes ? new ParticleSystem.MinMaxCurve(0.35f, 0.8f) : new ParticleSystem.MinMaxCurve(0.5f, 1.4f);
            main.startSize = cubes ? new ParticleSystem.MinMaxCurve(0.05f, 0.13f) : new ParticleSystem.MinMaxCurve(0.8f, 2.4f);
            var emission = ps.emission;
            emission.enabled = false;
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = cubes ? 0.1f : 0.4f;
            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1, cubes ? AnimationCurve.Linear(0, 1, 1, 0.2f) : AnimationCurve.Linear(0, 0.6f, 1, 1.6f));
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.sharedMaterial = mat;
            if (cubes)
            {
                r.renderMode = ParticleSystemRenderMode.Mesh;
                r.mesh = Art.Cube;
                var col = ps.collision;
                col.enabled = true;
                col.type = ParticleSystemCollisionType.Planes;
                col.SetPlane(0, transform);           // the Game object sits at y = 0, facing up
                col.bounce = 0.15f;
                col.dampen = 0.6f;
            }
            ps.Play();
            return ps;
        }

        void Emit(ParticleSystem ps, Vector3 at, int n, float speed)
        {
            var e = new ParticleSystem.EmitParams { position = at, applyShapeToPosition = true };
            for (int i = 0; i < n; i++)
            {
                var v = Random.insideUnitSphere * speed;
                v.y = Mathf.Abs(v.y) + speed * 0.4f;
                e.velocity = v;
                ps.Emit(e, 1);
            }
        }

        void Blood(Vector3 at, int n, float speed) => Emit(blood, at, n, speed);

        void ClearCombat()
        {
            foreach (var b in bullets) Recycle(bulletPool, b.view);
            bullets.Clear();
            foreach (var g in grenades) Recycle(grenadePool, g.view);
            grenades.Clear();
            blood.Clear(); fire.Clear(); smoke.Clear();
        }

        static void Recycle(Stack<GameObject> pool, GameObject go) { go.SetActive(false); pool.Push(go); }

        GameObject Take(Stack<GameObject> pool, Mesh mesh, Material mat, Vector3 scale)
        {
            if (pool.Count > 0) { var g = pool.Pop(); g.SetActive(true); return g; }
            return Art.Part(transform, mesh, mat, Vector3.zero, scale, "shot");
        }

        void Fire(Target target)
        {
            var p = player;
            var w = p.Weapon;
            var s = w.stats;
            bool emptied = w.Consume();
            var mz = Muzzle();
            if (w.Explosive)
            {
                float tx = target.x + (rng.Next() - 0.5f) * 2 * w.Spread * 4, tz = target.z + (rng.Next() - 0.5f) * 2 * w.Spread * 4;
                Lob(mz, tx, tz, s.damage, s.blast);
            }
            else
            {
                for (int i = 0; i < s.pellets && bullets.Count < MaxBullets; i++)
                {
                    float a = p.yaw + (rng.Next() * 2 - 1) * w.Spread, speed = 62 + rng.Next() * 8;
                    // From the survivor's centre, not the muzzle: pressed against
                    // a wall, the muzzle is already past it.
                    bullets.Add(new Bullet
                    {
                        x = p.x, z = p.z, dx = Mathf.Sin(a), dz = Mathf.Cos(a), speed = speed, life = s.range / speed + 0.05f,
                        damage = s.damage, pierce = s.pierce, knock = s.knockback,
                        view = Take(bulletPool, Art.Cube, tracerMat, new Vector3(0.06f, 0.06f, 1.1f)),
                    });
                }
            }
            muzzleLight.transform.position = mz + Vector3.up * 0.1f;
            muzzleLight.intensity = 3;
            muzzleFlash.SetActive(true);
            muzzleFlash.transform.position = mz;
            muzzleFlash.transform.rotation = Quaternion.LookRotation(cam.transform.forward);
            muzzleFlash.transform.localScale = Vector3.one * (s.pellets > 1 || w.Explosive ? 1.8f : 1.1f + rng.Next() * 0.5f);
            flashT = 0.045f;
            p.kick = 1;
            shake = Mathf.Max(shake, s.shake);
            if (!s.fx.quiet) Noise(p.x, p.z);
            if (emptied) Reload();
        }

        float noiseAt = -1;
        // Gunfire brings idle zombies within earshot running.
        void Noise(float x, float z)
        {
            if (time - noiseAt < 0.25f) return;
            noiseAt = time;
            float r2 = Tunables.GunfireNoise * Tunables.GunfireNoise;
            foreach (var zb in zombies)
            {
                if (zb.dead || zb.mode != Zombie.Mode.Idle || zb.calm) continue;
                float dx = zb.x - x, dz = zb.z - z;
                if (dx * dx + dz * dz < r2) zb.mode = Zombie.Mode.Chase;
            }
        }

        void UpdateBullets(float dt)
        {
            for (int i = bullets.Count - 1; i >= 0; i--)
            {
                var b = bullets[i];
                float remaining = b.speed * dt;
                bool alive = true;
                float toWall = road.FacadeT(b.x, b.z, b.dx, b.dz, remaining);
                // Sweep the segment so fast bullets never skip a zombie.
                while (alive && remaining > 0)
                {
                    Zombie hit = null;
                    float hitT = Mathf.Min(remaining, toWall);
                    foreach (var z in zombies)
                    {
                        if (z.dead || (b.hits != null && b.hits.Contains(z))) continue;
                        float ox = z.x - b.x, oz = z.z - b.z, t = ox * b.dx + oz * b.dz;
                        if (t < -z.radius || t > hitT + z.radius) continue;
                        float px = ox - b.dx * t, pz = oz - b.dz * t, r = z.radius + 0.12f;
                        if (px * px + pz * pz < r * r)
                        {
                            float tt = Mathf.Max(0, t - Mathf.Sqrt(r * r - (px * px + pz * pz)));
                            if (tt < hitT) { hitT = tt; hit = z; }
                        }
                    }
                    if (hit == null)
                    {
                        if (toWall <= remaining) { b.x += b.dx * toWall; b.z += b.dz * toWall; alive = false; }
                        else { b.x += b.dx * remaining; b.z += b.dz * remaining; }
                        break;
                    }
                    b.x += b.dx * hitT; b.z += b.dz * hitT;
                    remaining -= hitT; toWall -= hitT;
                    DamageZombie(hit, b.damage, b.dx, b.dz, b.knock);
                    if (b.pierce > 0) { b.pierce--; (b.hits ??= new List<Zombie>()).Add(hit); }
                    else alive = false;
                }
                b.life -= dt;
                if (!alive || b.life <= 0) { Recycle(bulletPool, b.view); bullets.RemoveAt(i); continue; }
                b.view.transform.position = new Vector3(b.x - b.dx * 0.5f, 1.4f, b.z - b.dz * 0.5f);
                b.view.transform.rotation = Quaternion.LookRotation(new Vector3(b.dx, 0, b.dz));
            }
        }

        // A grenade from `from` that lands on (tx, tz): fixed horizontal
        // speed, vertical speed solved to come down on the spot.
        void Lob(Vector3 from, float tx, float tz, float damage, Blast blast, float speed = 15)
        {
            if (grenades.Count >= MaxGrenades) return;
            float dx = tx - from.x, dz = tz - from.z, d = Mathf.Sqrt(dx * dx + dz * dz), t = Mathf.Max(d / speed, 0.15f);
            grenades.Add(new Grenade
            {
                x = from.x, y = from.y, z = from.z, sx = from.x, sz = from.z, vx = dx / t, vz = dz / t,
                vy = (0 - from.y + 0.5f * Gravity * t * t) / t, life = t + 0.6f, damage = damage, blast = blast,
                view = Take(grenadePool, Art.Cube, shellMat, Vector3.one * 0.22f),
            });
        }

        void UpdateGrenades(float dt)
        {
            for (int i = grenades.Count - 1; i >= 0; i--)
            {
                var g = grenades[i];
                g.vy -= Gravity * dt;
                g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
                g.spin += dt * 12;
                g.life -= dt;
                bool boom = g.y <= 0.15f || g.life <= 0;
                if (!boom)
                    foreach (var z in zombies)
                        if (!z.dead && g.y < 2 * z.scale && Vector2.Distance(new Vector2(z.x, z.z), new Vector2(g.x, g.z)) < z.radius + 0.2f) { boom = true; break; }
                if (boom)
                {
                    Recycle(grenadePool, g.view);
                    grenades.RemoveAt(i);
                    Explode(g.x, g.z, g.blast.radius, g.damage, g.blast.impulse, mine: true);
                    continue;
                }
                g.view.transform.position = new Vector3(g.x, g.y, g.z);
                g.view.transform.rotation = Quaternion.Euler(g.spin * Mathf.Rad2Deg, g.spin * 40, 0);
            }
        }

        // A blast: damage falling off with distance to zombies and the
        // survivor; anything it kills is thrown; fire, smoke and a flash.
        void Explode(float x, float z, float radius, float damage, float impulse, bool mine = false)
        {
            float Falloff(float d, float r) => Mathf.Max(0.25f, Mathf.Pow(1 - Mathf.Min(d / r, 1), 0.7f));
            foreach (var zb in zombies.ToArray())
            {
                if (zb.dead) continue;
                float dx = zb.x - x, dz = zb.z - z, d = Mathf.Sqrt(dx * dx + dz * dz);
                if (d > radius + zb.radius) continue;
                float u = d > 0 ? d : 1, f = Falloff(d, radius + zb.radius);
                DamageZombie(zb, damage * f, dx / u, dz / u, impulse * 0.5f, (4 + impulse * 0.35f) * f / zb.scale);
            }
            var p = player;
            float pd = Vector2.Distance(new Vector2(p.x, p.z), new Vector2(x, z));
            // Your own grenades sting less than a barrel going off beside you.
            if (state == State.Playing && pd < radius) HurtPlayer(damage * Falloff(pd, radius) * (mine ? 0.4f : 0.6f), x, z, blast: true);
            var at = new Vector3(x, 0.6f, z);
            Emit(fire, at, (int)(14 + radius * 3), 3 + radius * 0.6f);
            Emit(smoke, at + Vector3.up * 0.6f, (int)(8 + radius * 2), 1.5f + radius * 0.3f);
            Blood(at, 6, 4);
            blastLight.transform.position = new Vector3(x, 1.8f, z);
            blastLight.range = radius * 4;
            blastPeak = Mathf.Max(blastT > 0 ? blastLight.intensity : 0, 4 + radius * 0.8f);
            blastLight.intensity = blastPeak;
            blastT = 0.3f;
            shake = Mathf.Max(shake, Mathf.Max(0.25f, 0.6f + radius * 0.06f - pd / 30));
        }
    }
}
