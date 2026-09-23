---
title: 'RPi Lab Notes 1 — I Just Wanted to Work on a Kernel Patch'
description: 'Trying to get close to upstream Linux led me back to UART wiring and boot checks. Notes from setting up a Raspberry Pi 5 for kernel experiments.'
lang: en
translationKey: rpi-kernel-lab-setup
publishedAt: 2026-09-23
tags: [Raspberry-Pi, Linux, Kernel, UART, Ethernet, Upstream]
aiSummary: |
  - Goal: Set up a Raspberry Pi 5 to test kernel patches intended for upstream Linux.
  - Hardware: Raspberry Pi 5, Sipeed RV-Debugger Plus, jumper wires, development PC.
  - UART wiring: Pi physical pin 8 (GPIO14/TX) → adapter RX; pin 10 (GPIO15/RX) → adapter TX; pin 6 (GND) → GND. Power the Pi separately.
  - Observed: During custom-kernel experiments, UART output stopped after Image/DTB loading messages. Rebuilding with GCC produced similar symptoms.
  - Verified: A later Debian image reached an HDMI login prompt while GPIO UART remained silent. This does not prove that earlier custom kernels booted successfully.
  - Chosen topology: Direct UART and Ethernet connections to the PC. UART for logs; Ethernet for SSH and file transfer from a working baseline.
  - Status: End-to-end setup is not yet validated. IP configuration, Ethernet driver support, custom-kernel boot, GPIO UART, and remote reset/recovery need separate checks.
  - Next: Preserve working Debian → rebuild matching kernel source/config → verify HDMI boot → apply UART changes and development patches separately.
  - Scope: Personal experiment notes, not a universal Pi 5 installation recipe. Keep board-enablement changes separate from patches intended for upstream submission.
---

I wanted to send a patch to the Linux kernel.

Before that, I needed somewhere to run the code. Edit, build, boot it on an actual board. I had a Raspberry Pi 5, and Raspberry Pi OS was already running on it. Surely I could just build a kernel and swap it in?

Well. That took longer than expected.

## As close to upstream as possible

I didn't particularly want to start in the Raspberry Pi-specific kernel tree. The target was upstream Linux, so I wanted my test environment to be reasonably close to it.

I built an upstream kernel, copied over the `Image` and the DTB built from the same source, and changed the boot configuration.

Nothing.

Or rather, I thought nothing was happening.

Things that worked under Raspberry Pi OS didn't necessarily keep working after I replaced the kernel and DTB. I'd find another setting to try, only to discover that it assumed the Raspberry Pi kernel and device tree in the first place.

So how much of that setup was I supposed to bring along?

Using the Pi-specific tree moved me away from the environment I wanted. Moving closer to upstream meant checking the board features individually. “Supports Pi 5” wasn't enough information. Does that include the UART I'm using? What about networking? With which DTB and kernel configuration?

I came here to work on a kernel patch. I'm still setting up the test machine. Great.

## First, connect the UART

I had a Sipeed RV-Debugger Plus, so I pulled it out to capture boot logs.

The Pi 5 has a dedicated debug UART connector. I didn't have the cable for it. What I did have was a handful of jumper wires.

The 40-pin GPIO header it was.

```text
RPi 5                         Sipeed
Physical pin 8  / GPIO14 / TX ── RX
Physical pin 10 / GPIO15 / RX ── TX
Physical pin 6  / GND        ── GND
```

I even went back to check whether pin 8 was TX or RX. Between GPIO numbers and physical pin numbers, a three-wire connection suddenly deserves a second look.

The Pi had its own power supply. Only TX, RX, and GND were connected to the UART adapter.

After wiring it up and adjusting the settings, I started getting output.

```text
Loading 'Image' to 0x00000000 offset 0x200000
Read Image bytes 42772992 hnd 0x7ddc6
Device tree loaded to 0x2eff9100 (size 0x6e93)
```

And then it stopped.

Uh… what? Why does it get this far and then go silent?

The image seemed to have been read. The device tree seemed to have been loaded. Beyond that, I had no idea. Had the kernel crashed? Was the configuration wrong? Was I listening to the wrong UART?

Rebuilding with GCC gave me similar results. I looked at `earlycon`, changed `console=`, and questioned the DTB. Having lots of things to change wasn't particularly helpful at this point.

## …Wait, HDMI works?

Later, while testing a Debian image, I checked HDMI.

There was a picture.

The UART was quiet, but the monitor had a login prompt.

```text
localhost login:
```

Hold on. So it *did* boot?

That was a slightly painful moment. I had been treating the point where UART output stopped as the point where boot failed. But with this Debian image, the system had made it all the way to a login prompt.

Had the earlier attempts just been missing UART output too? Maybe. I don't know yet. I haven't gone back and checked those kernels under the same conditions.

Still, I needed to stop writing “doesn't work” as though that described anything useful.

```text
HDMI: login prompt visible
GPIO UART: no output after firmware messages
Custom-built kernel: needs separate verification
```

That's a much better note.

Firmware output on the GPIO UART and a Linux console on that same UART needed separate checks. Seeing text at the beginning had convinced me that both the wiring and the console setup were sorted out.

They weren't the same check.

## How many times am I going to pull this SD card out?

Somewhere along the way, another part of the process started bothering me.

Copy the build onto the card. Put it in the Pi. Test. Take it out again. Change the files. Fine once or twice, but doing that for every configuration change kept interrupting the work.

I'm setting this up specifically so I can keep changing the kernel.

I looked into U-Boot and whether I could do this wirelessly. I considered `kexec`, but it wasn't enabled in the working kernel I was using. I also looked at `tryboot`, with the normal boot configuration preserved and a different kernel selected for the next boot only.

After going back and forth on it, this was the arrangement I settled on aiming for:

```text
Development PC
  │
  ├── USB ── Sipeed ── UART ── RPi 5
  │
  └──────── Ethernet ────────── RPi 5
```

**Both UART and Ethernet connected directly to the PC.**

Use UART to watch the logs. Use Ethernet to connect to a working Pi and transfer files. There was no need to make UART handle kernel image transfers as well.

Wireless sounded more convenient at first. But I didn't want Wi-Fi to become another thing to debug while swapping kernels. For this setup, I'd rather have a cable and establish a working baseline for SSH and file transfer.

Of course, plugging in the cable isn't the whole job. The PC and Pi need IP configuration, and the test kernel needs working Ethernet support. If the kernel hangs before networking comes up, SSH won't help. That's why I still want UART alongside it.

Resetting a completely hung board is another unresolved piece. I can't call this an automated recovery setup yet.

## Keep a working baseline this time

Looking back, I changed too many things before I had a solid comparison point.

The kernel changed. The DTB changed. Boot arguments changed. No output? Find another setting. Eventually, it became difficult to explain what exactly was failing.

For now, I want to do this in order:

- Preserve a known-working boot environment.
- Check UART output and Ethernet connectivity separately.
- Build the kernel source and configuration corresponding to that environment.
- Verify that my own build boots too.
- Then add the UART changes or the patch I actually want to test.

Sending patches upstream is still the goal. I just want to keep the changes needed to make the board work separate from the patch I'm planning to submit.

The GPIO UART issue isn't fully resolved, and the development setup isn't finished. But I have a clearer idea of what I need now.

A way to see what happens after changing the kernel. A straightforward way to upload the next build. A working environment to return to when it fails.

I'd like to get that much in place first. Preferably before reaching for the SD card again.
