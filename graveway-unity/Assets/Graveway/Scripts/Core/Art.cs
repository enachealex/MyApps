// Placeholder art, all made in code: materials, box meshes and textures
// painted at start-up, like graveway/src/models.js. Everything here is meant
// to be swapped for real models and materials as they arrive; nothing else
// cares how a thing is drawn.
//
// Materials work in both the Built-in pipeline (Standard shader) and URP
// (Universal Render Pipeline/Lit), whichever the project uses.

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Graveway
{
    public static class Art
    {
        static Mesh cube, quad;
        public static Mesh Cube => cube != null ? cube : (cube = Resources.GetBuiltinResource<Mesh>("Cube.fbx"));
        public static Mesh Quad => quad != null ? quad : (quad = Resources.GetBuiltinResource<Mesh>("Quad.fbx"));

        static bool Urp => GraphicsSettings.currentRenderPipeline != null;

        static readonly Dictionary<string, Material> cache = new Dictionary<string, Material>();

        // A lit, matte material. Shared: the same colour gets the same one, so
        // Unity can batch and instance everything that uses it.
        public static Material Lit(Color c, float glow = 0, Texture tex = null, Texture glowTex = null)
        {
            string key = $"lit|{ColorUtility.ToHtmlStringRGBA(c)}|{glow}|{(tex ? tex.GetInstanceID() : 0)}|{(glowTex ? glowTex.GetInstanceID() : 0)}";
            if (cache.TryGetValue(key, out var m) && m != null) return m;
            m = new Material(Shader.Find(Urp ? "Universal Render Pipeline/Lit" : "Standard")) { enableInstancing = true };
            m.SetColor("_Color", c);
            m.SetColor("_BaseColor", c);
            m.SetFloat("_Glossiness", 0.12f);
            m.SetFloat("_Smoothness", 0.12f);
            if (tex) { m.SetTexture("_MainTex", tex); m.SetTexture("_BaseMap", tex); }
            if (glow > 0 || glowTex)
            {
                m.EnableKeyword("_EMISSION");
                m.SetColor("_EmissionColor", glowTex ? Color.white * Mathf.Max(glow, 1) : c * glow);
                if (glowTex) m.SetTexture("_EmissionMap", glowTex);
                m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
            }
            cache[key] = m;
            return m;
        }

        // Unlit and solid: tracers, eyes, warning lights.
        public static Material Unlit(Color c)
        {
            string key = $"unlit|{ColorUtility.ToHtmlStringRGBA(c)}";
            if (cache.TryGetValue(key, out var m) && m != null) return m;
            m = new Material(Shader.Find(Urp ? "Universal Render Pipeline/Unlit" : "Unlit/Color")) { enableInstancing = true };
            m.SetColor("_Color", c);
            m.SetColor("_BaseColor", c);
            cache[key] = m;
            return m;
        }

        // Additive glow, for pools of light and flashes. Uses a soft round
        // texture unless given another.
        public static Material Glow(Color c, Texture tex = null)
        {
            tex = tex ? tex : Tex.Glow;
            string key = $"glow|{ColorUtility.ToHtmlStringRGBA(c)}|{tex.GetInstanceID()}";
            if (cache.TryGetValue(key, out var m) && m != null) return m;
            m = new Material(Shader.Find(Urp ? "Universal Render Pipeline/Particles/Unlit" : "Legacy Shaders/Particles/Additive"));
            m.SetColor("_TintColor", c * 0.5f);
            m.SetColor("_BaseColor", c);
            m.SetTexture("_MainTex", tex);
            m.SetTexture("_BaseMap", tex);
            if (Urp)
            {
                // URP particles: transparent, additive.
                m.SetFloat("_Surface", 1);
                m.SetFloat("_Blend", 2);
                m.SetInt("_SrcBlend", (int)BlendMode.One);
                m.SetInt("_DstBlend", (int)BlendMode.One);
                m.SetInt("_ZWrite", 0);
                m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                m.renderQueue = (int)RenderQueue.Transparent;
            }
            cache[key] = m;
            return m;
        }

        // A child object showing `mesh` with `mat`.
        public static GameObject Part(Transform parent, Mesh mesh, Material mat, Vector3 pos, Vector3 scale, string name = "part")
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localScale = scale;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            return go;
        }

        public static GameObject Box(Transform parent, Vector3 size, Vector3 center, Material mat, string name = "box") =>
            Part(parent, Cube, mat, center, size, name);

        // A flat glow on the ground (a lamp's pool of light, a pickup's ring).
        public static GameObject GroundGlow(Transform parent, Color c, float size, Vector3 pos, Texture tex = null)
        {
            var go = Part(parent, Quad, Glow(c, tex), pos + Vector3.up * 0.03f, new Vector3(size, size, 1), "glow");
            go.transform.localRotation = Quaternion.Euler(90, 0, 0);
            return go;
        }
    }

    /* Builds one mesh out of many boxes, with UVs scaled to each box's real
       size (one texture tiles the same on a short shop and a tall tower).
       A chunk of street is a handful of these, one per material. */
    public sealed class MeshBuilder
    {
        readonly List<Vector3> verts = new List<Vector3>();
        readonly List<Vector3> norms = new List<Vector3>();
        readonly List<Vector2> uvs = new List<Vector2>();
        readonly List<int> tris = new List<int>();

        static readonly Vector3[] faceN = { Vector3.right, Vector3.left, Vector3.up, Vector3.down, Vector3.forward, Vector3.back };
        static readonly Vector3[] faceV = { Vector3.up, Vector3.up, Vector3.forward, Vector3.forward, Vector3.up, Vector3.up };

        public int Count => verts.Count;

        // tile: metres per texture repeat; 0 stretches the texture over each face.
        public void Box(Vector3 center, Vector3 size, float tile = 0, float yaw = 0)
        {
            var rot = Quaternion.Euler(0, yaw, 0);
            for (int f = 0; f < 6; f++)
            {
                Vector3 n = faceN[f], v = faceV[f], u = Vector3.Cross(n, v);
                float hn = Abs(n, size) * 0.5f, hu = Abs(u, size) * 0.5f, hv = Abs(v, size) * 0.5f;
                int b = verts.Count;
                for (int k = 0; k < 4; k++)
                {
                    float su = k == 1 || k == 2 ? 1 : -1, sv = k >= 2 ? 1 : -1;
                    var local = n * hn + u * (su * hu) + v * (sv * hv);
                    verts.Add(center + rot * local);
                    norms.Add(rot * n);
                    uvs.Add(tile > 0
                        ? new Vector2((su * hu + hu) / tile, (sv * hv + hv) / tile)
                        : new Vector2((su + 1) * 0.5f, (sv + 1) * 0.5f));
                }
                // Clockwise as seen from outside: Unity's front faces.
                tris.Add(b); tris.Add(b + 3); tris.Add(b + 2);
                tris.Add(b); tris.Add(b + 2); tris.Add(b + 1);
            }
        }

        // A flat rectangle facing up, at height y.
        public void Flat(Vector3 center, float width, float length, float tileU = 0, float tileV = 0)
        {
            int b = verts.Count;
            float hw = width * 0.5f, hl = length * 0.5f;
            Vector3[] c = { new Vector3(-hw, 0, -hl), new Vector3(hw, 0, -hl), new Vector3(hw, 0, hl), new Vector3(-hw, 0, hl) };
            for (int k = 0; k < 4; k++)
            {
                verts.Add(center + c[k]);
                norms.Add(Vector3.up);
                float u = (k == 1 || k == 2) ? 1 : 0, v = k >= 2 ? 1 : 0;
                uvs.Add(new Vector2(tileU > 0 ? u * width / tileU : u, tileV > 0 ? v * length / tileV : v));
            }
            tris.Add(b); tris.Add(b + 3); tris.Add(b + 2);
            tris.Add(b); tris.Add(b + 2); tris.Add(b + 1);
        }

        static float Abs(Vector3 axis, Vector3 size) =>
            Mathf.Abs(axis.x) * size.x + Mathf.Abs(axis.y) * size.y + Mathf.Abs(axis.z) * size.z;

        public Mesh Build(string name = "built")
        {
            var m = new Mesh { name = name };
            if (verts.Count > 65000) m.indexFormat = IndexFormat.UInt32;
            m.SetVertices(verts);
            m.SetNormals(norms);
            m.SetUVs(0, uvs);
            m.SetTriangles(tris, 0);
            m.RecalculateBounds();
            return m;
        }

        // Adds the mesh to `parent` as one renderer, if anything was built.
        public GameObject Emit(Transform parent, Material mat, string name, List<Object> owned)
        {
            if (verts.Count == 0) return null;
            var mesh = Build(name);
            owned.Add(mesh);
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            return go;
        }
    }

    /* Textures painted at start-up. */
    public static class Tex
    {
        static Texture2D glow, ring, road, walk;
        static Texture2D[] facades, facadeLights;

        static Texture2D Make(int w, int h, bool repeat = true)
        {
            var t = new Texture2D(w, h, TextureFormat.RGBA32, true) { wrapMode = repeat ? TextureWrapMode.Repeat : TextureWrapMode.Clamp };
            t.filterMode = FilterMode.Bilinear;
            t.anisoLevel = 4;
            return t;
        }

        // A soft white blob.
        public static Texture2D Glow
        {
            get
            {
                if (glow) return glow;
                glow = Make(64, 64, false);
                var px = new Color[64 * 64];
                for (int y = 0; y < 64; y++)
                    for (int x = 0; x < 64; x++)
                    {
                        float d = Mathf.Clamp01(Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(32, 32)) / 32);
                        float a = Mathf.Pow(1 - d, 2.2f);
                        px[y * 64 + x] = new Color(a, a, a, a);
                    }
                glow.SetPixels(px);
                glow.Apply();
                return glow;
            }
        }

        // A soft white ring, for the survivor's marker and pickups.
        public static Texture2D Ring
        {
            get
            {
                if (ring) return ring;
                ring = Make(128, 128, false);
                var px = new Color[128 * 128];
                for (int y = 0; y < 128; y++)
                    for (int x = 0; x < 128; x++)
                    {
                        float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(64, 64)) / 64;
                        float a = Mathf.Clamp01(1 - Mathf.Abs(d - 0.78f) / 0.14f);
                        a = a * a + (d < 0.7f ? 0.06f : 0);
                        px[y * 128 + x] = new Color(a, a, a, a);
                    }
                ring.SetPixels(px);
                ring.Apply();
                return ring;
            }
        }

        // Asphalt: 12 m wide (the road), one tile every 16 m, with a dashed
        // yellow centre line and white edges.
        public static Texture2D Road
        {
            get
            {
                if (road) return road;
                const int W = 192, H = 256;
                road = Make(W, H);
                var rng = new Rng(11);
                var px = new Color[W * H];
                for (int y = 0; y < H; y++)
                    for (int x = 0; x < W; x++)
                    {
                        float n = 0.16f + rng.Next() * 0.05f;
                        var c = new Color(n, n, n * 1.06f);
                        float m = x / (float)W * 12;                      // metres across
                        if (Mathf.Abs(m - 6) < 0.1f && (y / (float)H * 16) % 4 < 2.2f) c = new Color(0.78f, 0.62f, 0.18f);
                        if (Mathf.Abs(m - 0.35f) < 0.07f || Mathf.Abs(m - 11.65f) < 0.07f) c = new Color(0.62f, 0.62f, 0.6f);
                        px[y * W + x] = c;
                    }
                // a few cracks and stains
                for (int k = 0; k < 40; k++)
                {
                    int cx = (int)(rng.Next() * W), cy = (int)(rng.Next() * H), len = 8 + (int)(rng.Next() * 30);
                    float dx = rng.Next() - 0.5f, dy = rng.Next() - 0.5f;
                    for (int s = 0; s < len; s++)
                    {
                        int x = ((int)(cx + dx * s * 2) % W + W) % W, y = ((int)(cy + dy * s * 2) % H + H) % H;
                        px[y * W + x] *= 0.55f;
                    }
                }
                road.SetPixels(px);
                road.Apply();
                return road;
            }
        }

        // Paving slabs, 1 m squares.
        public static Texture2D Sidewalk
        {
            get
            {
                if (walk) return walk;
                walk = Make(64, 64);
                var rng = new Rng(5);
                var px = new Color[64 * 64];
                for (int y = 0; y < 64; y++)
                    for (int x = 0; x < 64; x++)
                    {
                        float n = 0.38f + rng.Next() * 0.05f;
                        bool seam = x % 32 == 0 || y % 32 == 0;
                        px[y * 64 + x] = seam ? new Color(0.22f, 0.22f, 0.23f) : new Color(n, n, n * 0.98f);
                    }
                walk.SetPixels(px);
                walk.Apply();
                return walk;
            }
        }

        // Building fronts: rows of windows, a few lit. Each comes with a glow
        // texture holding only the lit windows. One tile is 8 x 8 m.
        public static Texture2D[] Facades { get { MakeFacades(); return facades; } }
        public static Texture2D[] FacadeLights { get { MakeFacades(); return facadeLights; } }

        static void MakeFacades()
        {
            if (facades != null) return;
            facades = new Texture2D[3];
            facadeLights = new Texture2D[3];
            var rng = new Rng(23);
            for (int f = 0; f < 3; f++)
            {
                const int S = 128;
                var t = Make(S, S); var g = Make(S, S);
                var px = new Color[S * S]; var gx = new Color[S * S];
                float b = 0.42f + f * 0.06f;
                for (int i = 0; i < px.Length; i++) { float n = b + rng.Next() * 0.04f; px[i] = new Color(n, n * 0.97f, n * 0.94f); gx[i] = Color.black; }
                int cols = 3 + f, rows = 3;
                for (int r = 0; r < rows; r++)
                    for (int c = 0; c < cols; c++)
                    {
                        int w = S / cols, h = S / rows;
                        int x0 = c * w + w / 4, x1 = c * w + w * 3 / 4, y0 = r * h + h / 4, y1 = r * h + h * 3 / 4;
                        bool lit = rng.Next() < 0.22f;
                        var wc = lit ? new Color(0.95f, 0.78f, 0.45f) : new Color(0.07f, 0.09f, 0.11f);
                        for (int y = y0; y < y1; y++)
                            for (int x = x0; x < x1; x++)
                            {
                                px[y * S + x] = wc;
                                if (lit) gx[y * S + x] = new Color(0.9f, 0.7f, 0.4f);
                            }
                    }
                t.SetPixels(px); t.Apply();
                g.SetPixels(gx); g.Apply();
                facades[f] = t; facadeLights[f] = g;
            }
        }
    }
}
