# Z-Wave and other home devices

Two ways to bring Z-Wave devices into Surveil. They aren't exclusive: start
with the first, add the second only for devices you want fully local.

## Your panel: Qolsys IQ Panel 2

What the IQ Panel 2 means for each path:

- **Path A works as written.** The IQ2 is the Z-Wave primary controller and
  reports every paired device to Alarm.com.
- **The IQ2 can't join another Z-Wave network as a secondary.** The menus
  show "Controller Shift" and secondary options, but Alarm Grid tested it and
  it doesn't work. That rules out putting the panel under a USB stick.
- **The reverse direction is possible.** The IQ2 can stay primary and include
  another controller as its secondary. In theory a zwave-js stick could join
  the panel's network that way and see the panel's devices locally. In
  practice zwave-js is built to be the primary and its secondary support is
  limited. Try it only with the stick and one non-critical device, and expect
  it not to work.
- **Bonus local path for sensors (Path C below).** The IQ2's "3rd Party
  Connections" (Control4) interface gives LAN access to the panel's sensors
  and arm state without the cloud.

Find the firmware under Settings → Advanced Settings → About (dealer or
installer code needed for some menus). Path C needs 2.5.3 or later.

## Path A: through Alarm.com (no new hardware)

Your Alarm.com panel is already a Z-Wave controller. Every Z-Wave device
paired to it (locks, light switches, dimmers, plugs, thermostats, garage
door controllers, water valves) shows up in Alarm.com's web API, the same
unofficial API the camera adapter already logs into. The maintained Home
Assistant library reads and controls all of these today.

| Device type | Alarm.com resource | Actions |
| --- | --- | --- |
| Locks | `devices/lock` | lock, unlock |
| Lights and dimmers | `devices/light` | turnOn, turnOff, brightness |
| Switches and plugs | `devices/switch` | turnOn, turnOff |
| Thermostats | `devices/thermostat` | setState (mode, setpoints, fan) |
| Garage doors | `devices/garage-door` | open, close |
| Gates | `devices/gate` | open, close |
| Water valves | `devices/water-valve` | open, close |
| Panel sensors (doors, windows, motion, water) | `devices/sensor` | read only |

State changes arrive live on the event websocket we already open for camera
motion: DoorLocked (91), DoorUnlocked (90), Opened (15), Closed (0),
LightTurnedOn (315), LightTurnedOff (316), thermostat changes (94, 95, 120).
Panel sensors come along for free even though most of them aren't Z-Wave.

**What this gives Surveil**

- Device state on the camera it belongs to: the Front door tile shows
  "Locked" with a lock/unlock button; the Garage tile shows open/closed.
- Sensor-triggered events: a door opening records an event with a snapshot
  from the linked camera, even if the camera's own motion detection missed it.
- A **Devices** tab listing everything, with on/off and lock controls.

**Pros:** works today, no pairing changes, devices keep working in the
Alarm.com app and in your monitoring. **Cons:** cloud round trip (1–3 s), and
it stops when the internet or Alarm.com's unofficial API does.

## Path B: local Z-Wave with a USB stick

A Z-Wave 800-series USB stick plugged into the Surveil host, driven by
`zwave-js`, the open-source Z-Wave driver that Home Assistant uses. It is a
Node.js/TypeScript library, so it runs inside our server process with no
extra service.

- **Stick:** Zooz ZST39 LR (about $40), Home Assistant ZWA-2, or Aeotec
  Z-Stick 10 Pro (Z-Wave plus Zigbee). Update the firmware to SDK 7.23.2 or
  later before pairing anything. Use a short USB extension cable so the stick
  sits away from the host's metal case and USB 3.0 noise.
- **Pros:** fully local, instant (tens of milliseconds), works with the
  internet down, exposes every Z-Wave command class including ones Alarm.com
  hides (energy meters, scene buttons, battery levels, configuration
  parameters).
- **The catch:** a Z-Wave device belongs to exactly one network. To move a
  device from the panel to the stick you exclude it from the panel and include
  it on the stick, and it then disappears from Alarm.com, its app, its
  automations and its monitoring. Sharing one network between the panel and
  the stick is covered in the IQ Panel 2 section above: the panel can't be
  the secondary, and the stick as the panel's secondary is a long shot. Don't
  plan on it.

So Path B is for **new** devices you buy for Surveil, or for anything you
decide to take off Alarm.com on purpose. Don't move a lock that your
monitoring company relies on.

## Path C: panel sensors over the LAN (IQ2 firmware 2.5.3+)

The IQ Panel 2 has a local interface meant for Control4 home automation.
Turned on, it opens TLS port 12345 on the panel and accepts a 6-character
token. The open-source `qolsysgw` gateway uses it to bring the panel into
Home Assistant.

- **What it gives:** every panel zone (door and window contacts, motion,
  glass break, water, smoke) and the partition's arm state, pushed the moment
  they change. That's instant, works with the internet down, and needs no
  hardware. It's the best trigger source for "door opened → snapshot".
- **What it doesn't:** Z-Wave locks, lights and thermostats. Those stay on
  Path A.
- **How to turn it on:** dealer code, then Settings → Advanced Settings →
  Installation → Devices → Wi-Fi Devices → 3rd Party Connections → Control4.
  Note the token. Give the panel a fixed IP in the router.
- **Caveats:** the interface can also arm and disarm, so the token is a key to
  the alarm. It goes in `server/config.json` (git-ignored) only. Surveil
  sends only status requests on it and never arm or disarm commands. The
  panel allows about two connections at once and drops idle ones, so send a
  keep-alive every few minutes, as `qolsysgw` does.
- **Code:** a `QolsysAdapter` that implements only the sensor side of
  `DeviceAdapter`, ported from `qolsysgw`'s protocol handling (Python).

## How it fits the code

Add a second adapter contract next to `CameraAdapter`:

```ts
interface DeviceAdapter {
  readonly name: string;                  // "alarmcom" | "zwave"
  listDevices(): Promise<Device[]>;
  setState(externalId: string, cmd: DeviceCommand): Promise<void>;
  onChange(cb: (d: DeviceChange) => void): () => void;
}

type Device = {
  id: string;                             // "alarmcom:12345-7", "zwave:14"
  kind: "lock" | "light" | "switch" | "thermostat" | "garage" | "valve" | "contact" | "motion" | "water";
  name: string;
  state: Record<string, unknown>;         // { locked: true } / { on: true, level: 60 } / { open: false }
  battery?: number;
  linkedCameraId?: string;                // set in the UI
};
```

- `AlarmComAdapter` implements both interfaces and shares its session and
  event websocket.
- `ZWaveAdapter` wraps a `zwave-js` `Driver` on the stick's serial port
  (`/dev/serial/by-id/...` on Linux, `COM3` on Windows), maps value
  notifications to `DeviceChange`, and stores network security keys in
  `server/data/` (back these up; losing them means re-pairing every secure
  device).
- New SQLite tables: `devices` (id, adapter, kind, name, linked_camera_id) and
  `device_events` (device_id, at, state). Contact and motion changes also go
  through the existing event pipeline so they get snapshots and ntfy alerts.

## Safety rules for control

- Lock, unlock, garage open and valve close need a confirm tap in the UI and
  are logged with who did it (Cloudflare Access identity, Phase 5).
- Arming and disarming the alarm system stays out of Surveil. That belongs to
  the Alarm.com app and your monitoring company.
- Until Phase 5 puts the app behind a login, control endpoints only accept
  requests from the LAN.

## Order of work

1. Path A read-only: Devices tab, state on camera tiles, door/motion sensors
   as events. One weekend, after Phase 2.
2. Path A control: lock/unlock, lights, garage, with the confirmation rules.
   One evening.
3. Path C: switch sensor events to the panel's local interface, keeping Path A
   as the fallback. One evening, once the firmware is confirmed 2.5.3+.
4. Path B: only if you buy a stick. Pairing UI (inclusion with S2 PIN entry,
   exclusion, heal), then the same Devices tab. One to two weekends.

## Sources

- https://github.com/ibasebcast/ha-alarmdotcom (Alarm.com device controllers
  and websocket event codes)
- https://github.com/zwave-js/zwave-js
- https://www.home-assistant.io/docs/z-wave/controllers/
- https://www.alarmgrid.com/faq/can-i-make-a-qolsys-iq-panel-2-a-secondary-z-wave-controller
- https://community.home-assistant.io/t/diy-alarm-w-added-monitoring-qolsys-iq-panel-4/595352
- https://www.alarmgrid.com/blog/qolsys-iq2-as-secondary-z-wave-controller-follow-up-does-not-wor
- https://community.home-assistant.io/t/qolsys-iq-panel-2-and-3rd-party-integration/231405
  (Control4 interface, `qolsysgw`)
