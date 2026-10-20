// Movement input, ported from graveway/src/input.js. On a phone you press
// anywhere on the play area and drag: a joystick appears under your thumb.
// Any number of fingers can be down. The first one on the play area steers;
// if it lifts while another is still down, that one takes over the stick
// where it is. Touches that start on a button don't steer.
// In the editor, the mouse acts as one finger and WASD / arrows also work.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Graveway
{
    public sealed class StickInput
    {
        const float Deadzone = 0.12f;
        const int MouseId = -100;

        public bool enabled;
        public Func<Vector2, bool> overUi = _ => false;   // set by the HUD: is this screen point on a button?

        public bool Active => pointer != int.MinValue;
        public Vector2 Origin { get; private set; }       // screen pixels
        public Vector2 Knob { get; private set; }         // offset from Origin, clamped to Radius
        public float Radius => Mathf.Max(48, (Screen.dpi > 0 ? Screen.dpi : 320) * 0.36f);

        Vector2 stick;
        int pointer = int.MinValue;
        readonly List<int> order = new List<int>();                    // fingers on the play area, oldest first
        readonly Dictionary<int, Vector2> fingers = new Dictionary<int, Vector2>();

        public void Update()
        {
            if (!enabled) { Release(); return; }
            for (int i = 0; i < Input.touchCount; i++)
            {
                var t = Input.GetTouch(i);
                Handle(t.fingerId, t.phase, t.position);
            }
            if (Input.touchCount == 0)
            {
                // Mouse as a finger (editor and desktop).
                if (Input.GetMouseButtonDown(0)) Handle(MouseId, TouchPhase.Began, Input.mousePosition);
                else if (Input.GetMouseButton(0)) Handle(MouseId, TouchPhase.Moved, Input.mousePosition);
                else if (Input.GetMouseButtonUp(0)) Handle(MouseId, TouchPhase.Ended, Input.mousePosition);
            }
        }

        void Handle(int id, TouchPhase phase, Vector2 pos)
        {
            switch (phase)
            {
                case TouchPhase.Began:
                    if (overUi(pos)) return;                      // a button press, not steering
                    fingers[id] = pos;
                    order.Remove(id); order.Add(id);
                    if (!Active) Grab(id, pos);
                    break;
                case TouchPhase.Moved:
                case TouchPhase.Stationary:
                    if (!fingers.ContainsKey(id)) return;
                    fingers[id] = pos;
                    if (id == pointer) Steer(pos);
                    break;
                default:                                          // ended or cancelled
                    if (!fingers.Remove(id)) return;
                    order.Remove(id);
                    if (id != pointer) return;
                    pointer = int.MinValue;
                    stick = Vector2.zero;
                    // Hand the stick to the finger that went down most recently.
                    if (order.Count > 0) { int next = order[order.Count - 1]; Grab(next, fingers[next]); }
                    break;
            }
        }

        void Grab(int id, Vector2 pos)
        {
            pointer = id;
            Origin = pos;
            Knob = Vector2.zero;
            stick = Vector2.zero;
        }

        void Steer(Vector2 pos)
        {
            var d = pos - Origin;
            float r = Radius, len = d.magnitude;
            // Past the rim the base follows the thumb, so changing direction
            // never means dragging all the way back across the circle.
            if (len > r * 1.35f)
            {
                Origin += d * ((len - r * 1.35f) / len);
                d = pos - Origin;
                len = d.magnitude;
            }
            var n = len > 0 ? d / len : Vector2.zero;
            float clamped = Mathf.Min(len, r);
            Knob = n * clamped;
            float mag = clamped / r;
            float m = mag < Deadzone ? 0 : (mag - Deadzone) / (1 - Deadzone);
            stick = n * m;
        }

        public void Release()
        {
            pointer = int.MinValue;
            fingers.Clear();
            order.Clear();
            stick = Vector2.zero;
            Knob = Vector2.zero;
        }

        // World-space direction: x across the road, z up the road.
        public Vector3 Move
        {
            get
            {
                float kx = (Key(KeyCode.D) || Key(KeyCode.RightArrow) ? 1 : 0) - (Key(KeyCode.A) || Key(KeyCode.LeftArrow) ? 1 : 0);
                float kz = (Key(KeyCode.W) || Key(KeyCode.UpArrow) ? 1 : 0) - (Key(KeyCode.S) || Key(KeyCode.DownArrow) ? 1 : 0);
                if (enabled && (kx != 0 || kz != 0)) return new Vector3(kx, 0, kz).normalized;
                return new Vector3(stick.x, 0, stick.y);
            }
        }

        static bool Key(KeyCode k) => Input.GetKey(k);
    }
}
