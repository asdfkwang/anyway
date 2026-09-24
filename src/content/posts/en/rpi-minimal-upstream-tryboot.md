---
title: 'RPi Lab Notes 3 — A Whole Day Just to Boot a Kernel'
description: 'From Debian configuration through VFS panics, RP1 interrupts, and deployment mistakes to a Raspberry Pi OS baseline with a separate upstream test kernel.'
lang: en
translationKey: rpi-minimal-upstream-tryboot
publishedAt: 2026-09-24
tags: [Raspberry-Pi, Linux, Kernel, Debian, Upstream, Tryboot, Rust, Debugging]
aiSummary: |
  - Goal: Build a minimal upstream-based test kernel for Raspberry Pi 5, retaining a working environment for recovery.
  - Baseline: Compared Debian source/configuration against stable v7.1.13 and reviewed 84 Debian patches. A later clean-tree boot showed that this patch set was not required for the boot scope tested; this is not a claim about all Pi features or Debian patches.
  - Configuration: Moved toward defconfig plus fragments. Without initramfs, the drivers needed to reach the SD root filesystem had to be built in, including the required storage path and ext4 support.
  - RP1 diagnosis: Traced MSI-X initialization through DT msi-parent → brcm,bcm2712-mip → CONFIG_BCM2712_MIP, which was modular in the failing setup. Also addressed VFAT mounting and USB/DWC3/HID in this configuration.
  - Non-kernel failures: Network profile/subnet mismatch prevented SSH; archive extraction replaced the /lib → usr/lib symlink and broke init; module/archive storage filled the root partition. HDMI was used for recovery.
  - Size and config lessons: Strip module debug information with INSTALL_MOD_STRIP=1; distinguish stripping from removing build targets. CONFIG_NET removal also removed UNIX sockets needed by systemd. Regenerate the base configuration before reapplying reduced fragments.
  - Patch work: dma::Range work used staged build, KUnit/doctest, QEMU, and Pi checks. Notes record 13 KUnit tests, 4 doctests, and 431 passing QEMU assertions; these counts do not establish equivalent hardware coverage.
  - Boot switching: kexec hung in this experiment. The tested upstream tree lacked the downstream notifier path used to pass the tryboot reboot request to firmware. Requesting tryboot from Raspberry Pi OS entered the test kernel; a subsequent ordinary reboot returned to stock.
  - Current topology: Raspberry Pi OS as the normal boot environment; separate test kernel/DTB/cmdline selected through tryboot; shared rootfs; QEMU for fast checks and Pi for hardware validation.
  - Limits: Automatic recovery from a hard hang is not established. Shared-rootfs deployment can damage the stock environment. Findings are scoped to the tested trees and setup, not universal installation instructions.
---

Last time, I said I was going with Debian.

There was a working kernel, and I could get its source and configuration. Reproduce that first, then reduce the differences from upstream. It seemed like a reasonable plan.

To skip to the end of this entry: the normal boot environment is Raspberry Pi OS again.

…That doesn't mean the Debian work was wasted. Following it through helped me figure out which parts I actually needed.

## I thought the Debian config would get me started

I prepared the Debian kernel source and cleaned up the build tree. I went looking for a Pi configuration, but the ARM64 source I was looking at didn't have the Pi-specific defconfig I had expected.

Right. Generic ARM64, supporting multiple boards.

So I took the configuration from the Debian headers package, adjusted the module-signing settings that didn't fit my local build, and ran `olddefconfig`.

I also pinned down the source version I was comparing against: `v7.1.13` in the stable tree. Before comparing everything with the latest master, I wanted to line up the same versions.

Then I counted the Debian patches. There were 84 in the set I inspected.

I expected something in there to be essential for booting the Pi. But as I read through them, I found changes for other architectures, build-tool fixes, and plenty that had little to do with this experiment.

Later, I also got a tree without that patch set to boot. At least **for the boot path I tested on this board, those Debian patches weren't required.**

That isn't the same as saying Debian's patches are all unnecessary. My experiment and a distribution supporting many machines have different requirements.

I kept Debian as a reference and started moving the test kernel toward `defconfig + a fragment of the settings I needed`.

## Before the kernel, I'd already got the IP wrong

The direct Ethernet connection was giving me trouble too.

The PC and Pi were connected, but SSH wouldn't work. Since I was changing kernels, network drivers were an easy suspect.

Except my environment file expected `192.168.10.2`, while the active connection was a shared-network profile on another subnet.

Wait. I'm looking at the wrong network?

I'd even found evidence that the Pi was connected, then kept trying the wrong address. Plugging in the cable and activating the configuration I had in mind were two separate things.

After that, I started checking the actual connection state and `ip neigh` before trusting the address in the script.

We hadn't even reached the kernel problems yet.

## Without initramfs, `=m` started looking different

This time, I wanted to boot directly into the SD card's root filesystem without an initramfs.

I'd been looking at some `=m` settings and thinking, fine, the feature is there. But loading those modules requires reaching storage and mounting a filesystem first.

And if the driver needed to do that is itself a module?

Oh.

The path needed to reach the root filesystem had to be built into the kernel. I didn't get all of it right in one go.

At first, I wasn't getting useful output. I worked through RP1 and networking settings, building them in as I checked. Eventually, I reached this:

```text
unknown-block(0,0)
```

Time to follow the SD path. I traced the DT `compatible` string to the driver, then checked the configuration options and dependencies that enabled it.

With that sorted out, root mounting was the next failure.

```text
CONFIG_EXT4_FS=m
```

Of course. The root filesystem is ext4.

By this point, a panic was almost welcome. At least the kernel was running and telling me how far it had got.

Better than silence. Seriously.

## Stuck at RP1 again

One of the errors I spent the longest looking at was RP1 initialization.

My notes had an `rp1_pci` failure, `-ENOTSUPP`, and the number `-542`. At first, I had no idea where to start following that number.

I ended up reading the code that checks MSI-X support. After spending time looking at the PCIe controller's MSI support, I went back to the device tree.

```text
msi-parent = <&mip1>
        ↓
brcm,bcm2712-mip
        ↓
CONFIG_BCM2712_MIP
```

And the option was set to `=m`.

Enabling an RP1 option wasn't enough to make everything RP1 depended on ready. I had to follow the interrupt provider too.

At least I now had a way to approach the next missing setting.

Find the device in the DT, find the driver, then check the Kconfig symbol and its dependencies. It looked slower than adding options from search results, but it was what finally let me explain the failure.

That wasn't the end of it.

Mounting `/boot/firmware` failed and dropped the system into emergency mode. In this setup, I resolved that by building in VFAT support. This was a different stage from reaching the root filesystem, but another missing piece in the environment I was assembling with fewer module dependencies.

Then I had a display but no working keyboard. Following the USB path led me back to DWC3 behind RP1 and the USB/HID configuration.

Every time it looked like it had booted, the next thing didn't work.

## Some of it was damage I'd done myself

Not every failure was a kernel configuration problem.

While extracting a tar archive of modules, I replaced the `/lib` symlink with a real directory. `/lib` had pointed to `usr/lib`; breaking that link meant the loader and required libraries were no longer accessible through their expected paths.

The result:

```text
No working init found
```

At first glance, another broken kernel. Except this time I'd damaged the root filesystem while deploying files.

I did this twice.

I thought `--no-overwrite-dir` would make the extraction safe, but with the archive and extraction method I tested, it didn't preserve the symlink the way I expected. I eventually adjusted the archive's `lib/` paths to land under `usr/lib/` instead.

Another time, I filled the root partition by uploading both the modules and their tarball. The notes say roughly 1.1GB of modules and a 1.3GB tarball.

SSH wasn't connecting properly either, so I recovered through the HDMI console.

I'd started this to make development convenient over UART and Ethernet. HDMI rescued me again.

## A 751MB amdgpu module?

While checking disk usage, I stopped at the size of `amdgpu.ko`.

751MB.

Why am I building this for the Pi right now? And why is it that big?

The module contained debug information. Importing Debian's broad configuration brought in a lot of build targets, and my manual installation wasn't automatically doing the size reduction performed during distribution packaging.

I used `INSTALL_MOD_STRIP=1`, then reduced the configuration itself. Savings from stripping and savings from no longer building things needed to be kept separate.

During the experiments, the kernel image also went from about 49MB to 37.8MB.

Smaller wasn't always better, though.

I disabled `CONFIG_NET` to remove networking and took UNIX sockets with it. Then systemd wouldn't work. Removing IP networking and removing the kernel's entire networking foundation were different changes.

I also got fragment management wrong. I thought deleting a line from a fragment would remove the old setting. It stayed when I reused an already-merged `.config`. I needed to regenerate the base configuration and apply the fragment again.

Now I check what ended up in the final `.config`, not just what I changed in the input.

## Can I test the patch now…?

There was actual patch work happening during all of this: a Rust-for-Linux `dma::Range` implementation and its tests.

I split verification into stages: building, KUnit and doctests, QEMU, then the Pi. The notes record 13 KUnit tests, 4 doctests, and 431 passing assertions under QEMU.

Check what I can in QEMU first, then use the Pi for the hardware checks.

While trimming the Pi configuration, I tried to keep the virtio settings needed for QEMU. I didn't want to lose the faster test environment while optimizing for one board.

It finally felt a little closer to the work I'd meant to do.

Then I got stuck switching kernels.

## Where I requested `tryboot` mattered too

`kexec` ended in a hang in this experiment.

So I went back to `tryboot`. Keep the normal kernel and select the experimental one for the next boot only. That sounded like what I wanted.

```bash
sudo reboot '0 tryboot'
```

It didn't behave as expected.

This time, I compared the upstream tree I was testing with the Raspberry Pi downstream implementation. The difference I found was in the path that passes the reboot string to the firmware. The upstream tree I tested didn't have the notifier implementation used downstream.

Firmware supporting a feature doesn't automatically mean the currently running kernel passes the request through to it.

I tried again with Raspberry Pi OS as the normal boot environment.

From there, `tryboot` entered the test kernel. An ordinary reboot afterward returned to the stock environment.

Finally. I'd made the round trip I wanted to test.

## Where the setup ended up

```text
Normal boot
    Raspberry Pi OS
        │
        └─ Request tryboot
               ↓
Test boot
    Separate kernel / DTB / cmdline
    Shared existing rootfs
               ↓
Ordinary reboot
    Back to Raspberry Pi OS
```

QEMU handles the faster checks during development. The Pi handles hardware validation. The normal environment stays available as the place to return to, with the test kernel managed separately.

This doesn't mean automatic power reset after a hard kernel hang is solved. The shared rootfs also means a bad deployment can damage the normal environment. Having broken `/lib` twice, I find that fairly easy to remember.

Last time, I chose Debian. This time, I returned to Raspberry Pi OS for normal boot while keeping the upstream-based test kernel separate.

I thought I'd spent a day fixing the kernel. Looking back, I'd also fixed a subnet, repaired a filesystem, and changed how I extracted an archive.

But I now have a way to boot a kernel I've built and get back again.

Next time, I'd like to spend more of the entry on the patch running inside this setup, and less on building the setup itself.
