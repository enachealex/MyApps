// Mulberry32, the same seeded generator as graveway/src/world.js, so a run
// seed always lays out the same road.

namespace Graveway
{
    public sealed class Rng
    {
        uint a;

        public Rng(uint seed) { a = seed; }

        // A number in [0, 1).
        public float Next()
        {
            unchecked
            {
                a += 0x6D2B79F5u;
                uint t = a;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + (t ^ (t >> 7)) * (t | 61u);
                return (float)((t ^ (t >> 14)) / 4294967296.0);
            }
        }

        public float Range(float lo, float hi) => lo + Next() * (hi - lo);
        public bool Chance(float p) => Next() < p;
        public T Pick<T>(T[] items) => items[(int)(Next() * items.Length) % items.Length];
    }
}
