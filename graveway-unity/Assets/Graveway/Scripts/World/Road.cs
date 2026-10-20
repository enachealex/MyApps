// The street: one endless road running up +z, built in 32 m chunks just
// beyond the fog and torn down once they're behind you. Each chunk is
// seeded by its index, so the same run seed lays out the same road.
// Ported from graveway/src/world.js (props, pickups and coins come next).
//
// A chunk's static scenery is merged into a few meshes, one per material,
// so a whole stretch of street is a handful of draw calls.

using System.Collections.Generic;
using UnityEngine;

namespace Graveway
{
    public sealed class Alley
    {
        public float x, z;
        public int side, chunk;
    }

    public sealed class Road
    {
        public const float RoadHalf = 6;            // asphalt from -6 to 6
        public const float WalkHalf = 7.4f;         // how far sideways anyone can go
        public const float FacadeX = WalkHalf + 0.6f;
        public const float Chunk = 32;
        const float Edge = -14;                     // where chunk 0 starts (behind the start)
        const float BuildAhead = 78, KeepBehind = 40;

        sealed class Built
        {
            public int i;
            public float z0, z1;
            public GameObject root;
            public readonly List<Object> owned = new List<Object>();
        }

        readonly Transform parent;
        readonly uint seed;
        readonly float startZ;
        readonly Dictionary<int, Built> chunks = new Dictionary<int, Built>();
        public readonly List<Alley> alleys = new List<Alley>();
        int first;

        static Material roadMat, walkMat, curbMat, underMat, litterMat;
        static Material[] facadeMats;

        public Road(Transform parent, uint seed, float startZ)
        {
            this.parent = parent;
            this.seed = seed;
            this.startZ = startZ;
            first = Mathf.Max(0, ChunkAt(startZ - 30));
            if (roadMat == null)
            {
                roadMat = Art.Lit(Color.white, 0, Tex.Road);
                walkMat = Art.Lit(Color.white, 0, Tex.Sidewalk);
                curbMat = Art.Lit(Hex.C(0x6a6a6c));
                underMat = Art.Lit(Hex.C(0x16171a));
                litterMat = Art.Lit(Hex.C(0x24262a));
                var tints = new[] { 0x9a8f86, 0x7f8790, 0x8e7a6a, 0x6f746c, 0xa39a8a, 0x7a6e74 };
                var list = new List<Material>();
                foreach (var t in tints)
                    for (int f = 0; f < Tex.Facades.Length; f++)
                        list.Add(Art.Lit(Hex.C(t), 0.9f, Tex.Facades[f], Tex.FacadeLights[f]));
                facadeMats = list.ToArray();
            }
        }

        public static int ChunkAt(float z) => Mathf.FloorToInt((z - Edge) / Chunk);

        public void Update(float pz)
        {
            int last = ChunkAt(pz + BuildAhead);
            for (int i = first; i <= last; i++) if (!chunks.ContainsKey(i)) Build(i);
            var drop = new List<int>();
            foreach (var kv in chunks) if (kv.Value.z1 < pz - KeepBehind) drop.Add(kv.Key);
            foreach (var i in drop) Drop(i);
            // Never rebuild what was torn down behind you.
            first = Mathf.Max(first, ChunkAt(pz - KeepBehind));
        }

        public void Dispose()
        {
            foreach (var i in new List<int>(chunks.Keys)) Drop(i);
        }

        void Drop(int i)
        {
            var ch = chunks[i];
            chunks.Remove(i);
            Object.Destroy(ch.root);
            foreach (var o in ch.owned) Object.Destroy(o);
            alleys.RemoveAll(a => a.chunk == i);
        }

        /* Where a line from (x, z) along (dx, dz) meets a building front
           (outside an alley), as a distance along it, or Infinity. */
        public float FacadeT(float x, float z, float dx, float dz, float len)
        {
            if (Mathf.Abs(dx) < 1e-6f) return float.PositiveInfinity;
            int side = dx > 0 ? 1 : -1;
            float t = (side * FacadeX - x) / dx;
            if (t < 0 || t > len) return float.PositiveInfinity;
            float zc = z + dz * t;
            foreach (var a in alleys) if (a.side == side && Mathf.Abs(zc - a.z) < 1.5f) return float.PositiveInfinity;
            return t;
        }

        void Build(int i)
        {
            var rng = new Rng(unchecked(seed * 7919u + (uint)i * 104729u));
            float z0 = Edge + i * Chunk, z1 = z0 + Chunk, zc = (z0 + z1) / 2;
            var ch = new Built { i = i, z0 = z0, z1 = z1, root = new GameObject($"chunk {i}") };
            ch.root.transform.SetParent(parent, false);
            chunks[i] = ch;
            var t = ch.root.transform;

            // Ground: road, sidewalks, kerbs and the dark beyond.
            var road = new MeshBuilder();
            road.Flat(new Vector3(0, 0, zc), RoadHalf * 2, Chunk, 12, 16);
            road.Emit(t, roadMat, "road", ch.owned);
            var walk = new MeshBuilder();
            foreach (var s in new[] { -1, 1 }) walk.Box(new Vector3(s * (RoadHalf + 1.5f), 0.08f, zc), new Vector3(3, 0.16f, Chunk), 2);
            walk.Emit(t, walkMat, "sidewalks", ch.owned);
            var curb = new MeshBuilder();
            foreach (var s in new[] { -1, 1 }) curb.Box(new Vector3(s * (RoadHalf + 0.09f), 0.1f, zc), new Vector3(0.18f, 0.2f, Chunk));
            curb.Emit(t, curbMat, "kerbs", ch.owned);
            var under = new MeshBuilder();
            under.Flat(new Vector3(0, -0.01f, zc), 80, Chunk);
            under.Emit(t, underMat, "under", ch.owned);

            // Buildings, with the odd alley for ambushes. One mesh per facade.
            var fronts = new MeshBuilder[facadeMats.Length];
            for (int k = 0; k < fronts.Length; k++) fronts[k] = new MeshBuilder();
            foreach (var s in new[] { -1, 1 })
            {
                float z = z0;
                while (z < z1 - 0.5f)
                {
                    float len = Mathf.Min(rng.Range(6, 13), z1 - z);
                    if (rng.Next() < 0.15f && len > 4 && z > startZ + 8)
                    {
                        const float w = 3.2f;
                        alleys.Add(new Alley { x = s * (WalkHalf + 1.6f), z = z + w / 2, side = s, chunk = i });
                        fronts[(int)(rng.Next() * fronts.Length)].Box(new Vector3(s * (WalkHalf + 9), 7, z + w / 2), new Vector3(1, 14, w + 2), 8);
                        z += w;
                        continue;
                    }
                    float h = rng.Range(6, 24), d = rng.Range(7, 11);
                    fronts[(int)(rng.Next() * fronts.Length)].Box(new Vector3(s * (WalkHalf + 0.6f + d / 2), h / 2, z + len / 2), new Vector3(d, h, len), 8);
                    z += len;
                }
            }
            for (int k = 0; k < fronts.Length; k++) fronts[k].Emit(t, facadeMats[k], "buildings", ch.owned);

            // Lamps every 16 m, alternating sides: a pole, an arm, a lit head
            // and a pool of light on the ground.
            var poles = new MeshBuilder();
            for (int k = 0; k < 2; k++)
            {
                int s = (i + k) % 2 == 1 ? 1 : -1;
                float lz = z0 + 6 + k * 16, lx = s * (RoadHalf + 0.6f);
                poles.Box(new Vector3(lx, 2.7f, lz), new Vector3(0.18f, 5.4f, 0.18f));
                poles.Box(new Vector3(lx - s * 0.9f, 5.35f, lz), new Vector3(1.9f, 0.12f, 0.14f));
                Art.Box(t, new Vector3(0.6f, 0.12f, 0.32f), new Vector3(lx - s * 1.7f, 5.25f, lz), Art.Unlit(Hex.C(0xffd9a0)), "lamp head");
                Art.GroundGlow(t, Hex.C(0xff9a3a) * 0.55f, 7.5f, new Vector3(lx - s * 1.7f, 0, lz));
            }
            poles.Emit(t, Art.Lit(Hex.C(0x2c2e33)), "lamp posts", ch.owned);

            // Litter: bags and boxes, one mesh for the whole chunk.
            var litter = new MeshBuilder();
            for (int k = 0; k < Chunk / 3; k++)
            {
                int s = rng.Next() < 0.5f ? -1 : 1;
                float lx = rng.Next() < 0.7f ? s * rng.Range(RoadHalf + 0.4f, WalkHalf) : rng.Range(-RoadHalf, RoadHalf);
                float sz = rng.Range(0.25f, 0.6f);
                litter.Box(new Vector3(lx, sz * 0.3f, rng.Range(z0, z1)), new Vector3(sz, sz * rng.Range(0.4f, 0.9f), sz * rng.Range(0.8f, 1.4f)), 0, rng.Range(0, 180));
            }
            litter.Emit(t, litterMat, "litter", ch.owned);

            // The barricade behind the start: there's no going back.
            float backZ = startZ - 5.4f;
            if (backZ >= z0 && backZ < z1)
            {
                var bar = new MeshBuilder();
                for (float x = -6; x <= 6; x += 2.4f) bar.Box(new Vector3(x, 0.48f, backZ), new Vector3(2.3f, 0.95f, 0.5f), 0, rng.Range(-5, 5));
                bar.Emit(t, Art.Lit(Hex.C(0xb8b2a6)), "barricade", ch.owned);
                var stripes = new MeshBuilder();
                for (float x = -6; x <= 6; x += 2.4f) stripes.Box(new Vector3(x, 0.75f, backZ - 0.26f), new Vector3(2.2f, 0.18f, 0.02f));
                stripes.Emit(t, Art.Lit(Hex.C(0xc23a2a), 0.3f), "barricade stripes", ch.owned);
            }
        }
    }
}
