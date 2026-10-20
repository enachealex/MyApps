// A person built from boxes, ported from makeHumanoid in models.js: the
// placeholder for both survivors and zombies until real rigged models
// arrive. Faces +z. Pivots sit at the hips, shoulders and neck so limbs
// swing naturally; `body` is what tips over when they die.
//
// To use a real model later, keep this class's shape (root, body, the
// pivots and SetFlash) and drive an Animator instead of the pivots.

using System.Collections.Generic;
using UnityEngine;

namespace Graveway
{
    public sealed class Humanoid
    {
        public readonly GameObject root;
        public readonly Transform body, legL, legR, armL, armR, head;
        readonly List<MeshRenderer> renderers = new List<MeshRenderer>();
        readonly List<Material> normal = new List<Material>();
        static Material flashMat;
        bool flashing;

        public Humanoid(string name, Color skin, Color shirt, Color pants, Color sleeves, Color? eyes, float bulk = 1)
        {
            root = new GameObject(name);
            body = new GameObject("body").transform;
            body.SetParent(root.transform, false);
            Transform Pivot(string n, Vector3 at) { var t = new GameObject(n).transform; t.SetParent(body, false); t.localPosition = at; return t; }
            // +x is the character's right.
            legL = Pivot("leg L", new Vector3(-0.15f, 0.82f, 0));
            legR = Pivot("leg R", new Vector3(0.15f, 0.82f, 0));
            armL = Pivot("arm L", new Vector3(-0.42f, 1.48f, 0));
            armR = Pivot("arm R", new Vector3(0.42f, 1.48f, 0));
            head = Pivot("head", new Vector3(0, 1.54f, 0));

            Material mSkin = Art.Lit(skin), mShirt = Art.Lit(shirt), mPants = Art.Lit(pants), mSleeves = Art.Lit(sleeves);
            Add(Art.Box(body, new Vector3(0.62f * bulk, 0.72f, 0.36f * bulk), new Vector3(0, 1.18f, 0), mShirt, "torso"));
            Add(Art.Box(legL, new Vector3(0.24f, 0.82f, 0.26f), new Vector3(0, -0.41f, 0), mPants, "leg"));
            Add(Art.Box(legR, new Vector3(0.24f, 0.82f, 0.26f), new Vector3(0, -0.41f, 0), mPants, "leg"));
            foreach (var arm in new[] { armL, armR })
            {
                Add(Art.Box(arm, new Vector3(0.19f, 0.72f, 0.2f), new Vector3(0, -0.34f, 0), mSleeves, "arm"));
                Add(Art.Box(arm, new Vector3(0.16f, 0.16f, 0.18f), new Vector3(0, -0.76f, 0.01f), mSkin, "hand"));
            }
            Add(Art.Box(head, new Vector3(0.4f, 0.42f, 0.4f), new Vector3(0, 0.21f, 0), mSkin, "head"));
            if (eyes.HasValue)
            {
                var me = Art.Unlit(eyes.Value);
                Add(Art.Box(head, new Vector3(0.09f, 0.06f, 0.03f), new Vector3(-0.09f, 0.25f, 0.205f), me, "eye"));
                Add(Art.Box(head, new Vector3(0.09f, 0.06f, 0.03f), new Vector3(0.09f, 0.25f, 0.205f), me, "eye"));
            }
            // A soft shadow underfoot.
            var shadow = Art.GroundGlow(root.transform, new Color(0, 0, 0, 1), 1.1f, Vector3.zero);
            shadow.GetComponent<MeshRenderer>().sharedMaterial = ShadowMat;
        }

        static Material shadowMat;
        static Material ShadowMat
        {
            get
            {
                if (shadowMat) return shadowMat;
                // Multiplicative-looking dark blob: the glow texture as alpha.
                var urp = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline != null;
                shadowMat = new Material(Shader.Find(urp ? "Universal Render Pipeline/Unlit" : "Sprites/Default"));
                shadowMat.SetTexture("_MainTex", Tex.Glow);
                shadowMat.SetTexture("_BaseMap", Tex.Glow);
                shadowMat.color = new Color(0, 0, 0, 0.55f);
                shadowMat.SetColor("_BaseColor", new Color(0, 0, 0, 0.55f));
                shadowMat.renderQueue = 2990;
                return shadowMat;
            }
        }

        void Add(GameObject g)
        {
            var r = g.GetComponent<MeshRenderer>();
            renderers.Add(r);
            normal.Add(r.sharedMaterial);
        }

        // A part's material for hats, packs and guns attached later.
        public void Attach(GameObject g) => Add(g);

        // White for a few frames when hit.
        public void SetFlash(bool on)
        {
            if (on == flashing) return;
            flashing = on;
            if (flashMat == null) flashMat = Art.Unlit(Hex.C(0xffd8c8));
            for (int i = 0; i < renderers.Count; i++) if (renderers[i]) renderers[i].sharedMaterial = on ? flashMat : normal[i];
        }

        public void SetVisible(bool on)
        {
            if (root.activeSelf != on) root.SetActive(on);
        }

        public static Humanoid Survivor(CharacterDef c)
        {
            var l = c.look;
            var h = new Humanoid(c.name, l.skin, l.shirt, l.pants, l.shirt, Hex.C(0x111111), l.bulk);
            h.Attach(Art.Box(h.body, new Vector3(0.46f, 0.5f, 0.2f), new Vector3(0, 1.2f, -0.27f), Art.Lit(Hex.C(0x3d3226)), "pack"));
            var hat = l.hat == "goggles" ? Art.Unlit(l.hatColor) : Art.Lit(l.hatColor);
            switch (l.hat)
            {
                case "cap":
                    h.Attach(Art.Box(h.head, new Vector3(0.44f, 0.12f, 0.5f), new Vector3(0, 0.46f, 0.04f), hat, "cap")); break;
                case "helmet":
                    h.Attach(Art.Box(h.head, new Vector3(0.5f, 0.26f, 0.5f), new Vector3(0, 0.42f, 0), hat, "helmet"));
                    h.Attach(Art.Box(h.head, new Vector3(0.44f, 0.08f, 0.06f), new Vector3(0, 0.3f, 0.24f), hat, "visor")); break;
                case "goggles":
                    h.Attach(Art.Box(h.head, new Vector3(0.44f, 0.06f, 0.44f), new Vector3(0, 0.3f, 0), hat, "strap"));
                    h.Attach(Art.Box(h.head, new Vector3(0.12f, 0.1f, 0.05f), new Vector3(-0.09f, 0.3f, 0.215f), hat, "lens"));
                    h.Attach(Art.Box(h.head, new Vector3(0.12f, 0.1f, 0.05f), new Vector3(0.09f, 0.3f, 0.215f), hat, "lens")); break;
                case "hood":
                    h.Attach(Art.Box(h.head, new Vector3(0.48f, 0.12f, 0.48f), new Vector3(0, 0.47f, -0.02f), hat, "hood"));
                    h.Attach(Art.Box(h.head, new Vector3(0.06f, 0.4f, 0.46f), new Vector3(-0.23f, 0.22f, -0.02f), hat, "hood"));
                    h.Attach(Art.Box(h.head, new Vector3(0.06f, 0.4f, 0.46f), new Vector3(0.23f, 0.22f, -0.02f), hat, "hood"));
                    h.Attach(Art.Box(h.head, new Vector3(0.48f, 0.4f, 0.06f), new Vector3(0, 0.22f, -0.23f), hat, "hood")); break;
            }
            // The green ring that marks you.
            Art.GroundGlow(h.root.transform, Hex.C(0x9be15d) * 0.5f, 2.1f, Vector3.zero, Tex.Ring);
            return h;
        }

        static readonly int[] ZSkin = { 0x7d9a6a, 0x8aa07a, 0x6b8560, 0x95a487, 0x7a8f74 };
        static readonly int[] ZShirt = { 0x5a4a3a, 0x3a4a5a, 0x6a3434, 0x4a4a4a, 0x7a6a4a, 0x2f4a3a, 0x6a5a6e };
        static readonly int[] ZPants = { 0x2f2f3a, 0x3a3226, 0x26303a, 0x403a30 };

        public static Humanoid Zombie(ZombieKind k, Rng rng)
        {
            int skin = rng.Pick(ZSkin), shirt = rng.Pick(ZShirt), pants = rng.Pick(ZPants);
            if (k.id == "runner") { skin = 0xa9b49c; shirt = rng.Pick(new[] { 0x6a3434, 0x4a4a4a, 0x3a3a5a }); }
            if (k.id == "tank") { skin = 0x5f7a50; shirt = skin; pants = 0x2a2a26; }
            if (k.id == "boss") { skin = 0x7a5a50; shirt = 0x5a3a34; pants = 0x231c1a; }
            int sleeves = k.id == "walker" && rng.Next() < 0.5f ? shirt : skin;
            return new Humanoid(k.id, Hex.C(skin), Hex.C(shirt), Hex.C(pants), Hex.C(sleeves), k.eyes);
        }
    }
}
