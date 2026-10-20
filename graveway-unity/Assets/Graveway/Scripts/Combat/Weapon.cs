// A Weapon is one gun in the survivor's hands for one run: a WeaponDef
// (Tunables.cs) with its fitted parts and the survivor's perk applied, plus
// live state: rounds left, reload progress, and recoil bloom from sustained
// fire. Ported from graveway/src/weapons.js and weaponStats in config.js.

using System.Collections.Generic;
using UnityEngine;

namespace Graveway
{
    // A gun's numbers with its parts fitted. fx gathers the parts' specials.
    public sealed class WeaponStats
    {
        public float damage, fireRate, spread, range, minRange, reloadTime, knockback, shake;
        public int ammoCapacity, pellets, pierce;
        public Recoil recoil;
        public Blast blast;
        public PartFx fx = new PartFx();

        public static WeaponStats Of(WeaponDef d, IDictionary<string, string> fitted, Perk perk)
        {
            var s = new WeaponStats
            {
                damage = d.damage, fireRate = d.fireRate, spread = d.spread, range = d.range, minRange = d.minRange,
                reloadTime = d.reloadTime, knockback = d.knockback, shake = d.shake,
                pellets = d.pellets, pierce = d.pierce, recoil = d.recoil, blast = d.blast?.Clone(),
            };
            float ammo = d.ammoCapacity;
            foreach (var slot in d.slots)
            {
                var part = Tunables.FittedPart(d, slot, fitted);
                if (part == null) continue;
                var m = part.mods;
                s.damage *= m.damage; s.fireRate *= m.fireRate; s.range *= m.range; ammo *= m.ammoCapacity;
                s.reloadTime *= m.reloadTime; s.spread *= m.spread; s.knockback *= m.knockback;
                s.recoil.per *= m.recoil;
                s.recoil.max /= m.stability; s.recoil.recover *= m.stability;
                s.pierce += m.pierce;
                if (m.pellets > 0) s.pellets = m.pellets;
                if (s.blast != null) { s.blast.radius *= m.blast; s.blast.impulse *= m.impulse; }
                if (part.fx != null) Merge(s.fx, part.fx);
            }
            if (s.fx.noPierce) s.pierce = 0;
            s.ammoCapacity = Mathf.Max(1, Mathf.RoundToInt(ammo));
            s.reloadTime *= perk != null ? perk.reloadMult : 1;
            return s;
        }

        static void Merge(PartFx into, PartFx f)
        {
            if (f.fireDps > into.fireDps) { into.fireDps = f.fireDps; into.fireTime = f.fireTime; }
            into.big *= f.big; into.small *= f.small; into.props *= f.props;
            into.quiet |= f.quiet; into.laser |= f.laser; into.light |= f.light; into.noPierce |= f.noPierce;
            into.cluster = Mathf.Max(into.cluster, f.cluster);
        }
    }

    public sealed class Weapon
    {
        public readonly WeaponDef def;
        public readonly IDictionary<string, string> fitted;   // slot -> part id
        public readonly WeaponStats stats;
        public int ammo;
        float reloadT, cooldown, bloom;

        public Weapon(string id, IDictionary<string, string> fitted, Perk perk)
        {
            def = Tunables.Weapon(id);
            this.fitted = fitted ?? new Dictionary<string, string>();
            stats = WeaponStats.Of(def, this.fitted, perk);
            ammo = stats.ammoCapacity;
        }

        public string Id => def.id;
        public string Name => def.name;
        public bool Reloading => reloadT > 0;
        public bool Explosive => def.grenade;

        // Current aim wobble: base spread plus recoil bloom.
        public float Spread => stats.spread + bloom;

        // 0..1 while reloading, else -1.
        public float ReloadProgress => reloadT > 0 ? 1 - reloadT / stats.reloadTime : -1;

        // Advances timers. Returns true on the frame a reload finishes.
        public bool Tick(float dt, bool firing)
        {
            cooldown = Mathf.Max(cooldown - dt, -0.05f);
            if (!firing) bloom = Mathf.Max(0, bloom - stats.recoil.recover * dt);
            if (reloadT > 0)
            {
                reloadT -= dt;
                if (reloadT <= 0)
                {
                    reloadT = 0;
                    ammo = stats.ammoCapacity;
                    bloom = 0;
                    return true;
                }
            }
            return false;
        }

        public bool CanFire => reloadT <= 0 && ammo > 0 && cooldown <= 0;

        // Spends one shot; true when that emptied the magazine. rateMult
        // speeds up the next shot and free keeps the round (Rapid Fire).
        public bool Consume(float rateMult = 1, bool free = false)
        {
            // Time left over from this frame carries into the next shot (Tick
            // floors it at -0.05 s), so fire rate doesn't round up to frames.
            cooldown += 1 / (stats.fireRate * rateMult);
            if (!free) ammo--;
            bloom = Mathf.Min(bloom + stats.recoil.per, stats.recoil.max);
            return ammo <= 0;
        }

        public bool StartReload()
        {
            if (reloadT > 0 || ammo >= stats.ammoCapacity) return false;
            reloadT = stats.reloadTime;
            return true;
        }

        public void CancelReload() => reloadT = 0;
    }
}
