# Turning the OpenEye OE-MEX16 into the Surveil host

The MEX16 is a 1U rack-mount x86 NVR appliance from OpenEye's discontinued
ME-Series. Under the OpenEye branding it is a normal Intel PC with a
16-port PoE switch bolted on, which is exactly what a self-hosted camera
server wants. Its own software (Apex on Linux) needs OpenEye Web Services
licences per channel, so we don't restore it. We install plain Debian and run
Surveil on it.

## What's in the box (from OpenEye's spec sheet)

| Item | MEX16 |
| --- | --- |
| CPU / RAM | Intel, exact model not published; find out with `lscpu` once booted |
| OS drive | Dedicated SSD |
| Data storage | Up to 24 TB (check what drives are actually installed) |
| Network port 1 "CLIENT" | Intel gigabit, meant for your home LAN |
| Network port 2 "CAMERA" | Intel gigabit, feeds the internal PoE switch |
| PoE | 16 ports, 150 W total, 25 W per port |
| Video out | HDMI (4K) or VGA |
| USB | 2 front USB 2.0, 2 rear USB 2.0, 2 rear USB 3.0 |
| Extras | 4 alarm inputs, 2 relay outputs, audio in/out |
| Power | 290 W internal PSU, up to 195 W draw |
| Boot menu | F12 during power-on; boot manager password `<boot-manager-password>` if asked (kept out of this repo) |

The two things that matter: it's x86 so any Linux boots on it, and the
CAMERA port + PoE switch give us an isolated camera network for free when we
add RTSP cameras in Phase 6.

## Things to check first (10 minutes, needs a monitor and keyboard)

1. Plug in HDMI and the keyboard, power on. Watch the POST screen for the
   CPU model and RAM.
2. Press **F12** for the boot menu. If it asks for a password, enter the boot manager
   password (`<boot-manager-password>`; not stored in this repo).
   If the OS SSD is truly blank it will drop here anyway.
3. Enter BIOS setup (Del or F2 at POST) and note: UEFI or legacy, whether
   Secure Boot is on, and the drives listed. Turn Secure Boot off if it's on.
4. Note the drive sizes. The SSD is the OS target; the big drive(s) will hold
   recordings.
5. Listen: it's a 1U unit with a 290 W supply and a fan. If it's loud, it
   wants a closet, not a desk.

If the machine won't POST or has no drives, tell me and we'll fall back to
hosting on this PC.

## Install Debian (30 minutes)

1. On this PC download the Debian 12 netinst ISO and write it to a USB stick
   with Rufus (GPT / UEFI unless the BIOS turned out to be legacy).
2. Plug the stick into a rear **USB 3.0** port, the CLIENT port into your
   home router, power on, F12, pick the USB stick.
3. Installer choices:
   - Hostname `surveil`, domain blank.
   - Partitioning: **guided, use entire disk** on the **SSD only**. Leave the
     data drives alone; we mount them after.
   - Software selection: untick "Debian desktop environment", tick
     **SSH server** and **standard system utilities**. No GUI: the HDMI is
     only for emergencies.
4. Reboot, pull the stick. From this PC: `ssh you@surveil.local` (or the IP
   your router shows).

## First boot setup

```bash
sudo apt update && sudo apt install -y curl git ffmpeg smartmontools lm-sensors
# Node 22 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v && ffmpeg -version | head -1
lscpu | grep 'Model name'; free -h; lsblk
```

Record the CPU, RAM, and `lsblk` output in this file.

### Recordings drive

```bash
sudo mkfs.ext4 -L surveil-data /dev/sdX     # the big drive from lsblk, NOT the SSD
sudo mkdir -p /srv/surveil
echo 'LABEL=surveil-data /srv/surveil ext4 defaults,noatime 0 2' | sudo tee -a /etc/fstab
sudo mount -a && df -h /srv/surveil
```

Check the drive's health while you're here: `sudo smartctl -H /dev/sdX`. A
surveillance drive that's been spinning in an NVR for years may be tired.

### Networking

- **CLIENT** port: DHCP from your router, as the installer set it. Reserve
  its IP in the router so the tunnel and your bookmarks stay stable.
- **CAMERA** port: not needed until Phase 6. When it is:

```bash
# Give the camera-side interface a static address and hand out DHCP to cameras
sudo apt install -y dnsmasq
# find the interface name for the CAMERA port: ip link (the one with no carrier until a camera is plugged in)
```

`/etc/network/interfaces.d/cameras`:
```
auto enp3s0          # replace with the CAMERA interface name
iface enp3s0 inet static
    address 10.10.0.1/24
```

`/etc/dnsmasq.d/cameras.conf`:
```
interface=enp3s0
dhcp-range=10.10.0.100,10.10.0.200,12h
```

Cameras plugged into the PoE ports then get 10.10.0.x addresses, are
reachable only from the MEX16, and are invisible to the rest of your house
and to the internet. This is the same isolated-camera-network design
OpenEye's own software used.

**To verify once:** that the PoE ports supply power with stock Linux running.
The switch is almost certainly powered straight from the PSU and independent
of the OS, but OpenEye doesn't document it. Plug any PoE device in and see if
it lights up. If it doesn't, the ports still work as a plain switch and a
cheap PoE injector or PoE switch fills the gap.

### Running Surveil as a service

Once Phase 1 code exists:

```bash
sudo useradd -r -s /usr/sbin/nologin surveil
sudo git clone https://github.com/enachealex/MyApps.git /opt/myapps   # or rsync just Surveil/
sudo chown -R surveil:surveil /opt/myapps/Surveil /srv/surveil
```

`/etc/systemd/system/surveil.service`:
```
[Unit]
Description=Surveil camera server
After=network-online.target
Wants=network-online.target

[Service]
User=surveil
WorkingDirectory=/opt/myapps/Surveil/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now surveil
journalctl -u surveil -f
```

Cloudflare Tunnel (`cloudflared`) installs the same way in Phase 5 and runs
as its own service.

## Why not restore OpenEye Apex instead?

OpenEye's USB recovery can reimage Apex, but Apex only records with a
per-channel licence and manages users through OpenEye Web Services. Without
an OpenEye account and licences it is a very nice box that records nothing.
And it can't see Alarm.com cameras at all. Plain Debian plus our code uses
the same hardware with no strings.

## Can the Alarm.com cameras plug into the PoE ports?

Only for power. Even wired, an Alarm.com camera talks exclusively to
Alarm.com's cloud, so it would need the CAMERA network to route to the
internet, which defeats the isolation. Leave them on Wi-Fi or their existing
PoE and reach them through the Alarm.com adapter as planned.
