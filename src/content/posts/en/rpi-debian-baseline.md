---
title: 'RPi Lab Notes 2 — Debian It Is, for Now'
description: 'Debian reached an HDMI login prompt, so I kept it as a baseline. Following the kernel source and configuration before changing anything else.'
lang: en
translationKey: rpi-debian-baseline
publishedAt: 2026-09-23
tags: [Raspberry-Pi, Linux, Kernel, Debian, UART, Upstream]
aiSummary: |
  - Goal: Establish a reproducible Raspberry Pi 5 baseline before testing patches intended for upstream Linux.
  - Selected image: Debian Forky raspi-arm64 daily, using a generic ARM64 kernel. This was not a Debian stable release.
  - Verified observation: The Debian image reached an HDMI login prompt while GPIO UART remained silent. This does not establish that earlier custom kernels booted.
  - Reasons for choosing Debian: Locally observed boot success, traceable kernel source/configuration, and a staged path toward upstream testing.
  - Distinction: Debian kernels include Debian patches and configuration; successful Debian boot does not prove unmodified torvalds/linux will boot.
  - Login result: Passwordless local root login did not work on the tested image. Setting a root password and using it allowed login. A daily-image bug was suspected, not confirmed; the underlying cause was not diagnosed.
  - Next experiment: Preserve working Debian; obtain matching source/configuration; rebuild while tracking kernel, DTB, modules, and initramfs; verify HDMI boot before adding GPIO UART changes.
  - Status: Debian boot and password-based login were confirmed. Custom-kernel reproduction and UART fixes remain separate, unverified steps in this entry.
---

Last time, I wrote about mistaking a silent UART for a failed boot.

I flashed a Debian image and checked HDMI. The GPIO UART was still quiet, but the monitor had a login prompt.

```text
localhost login:
```

Oh. So the kernel is running, at least.

That changed what I wanted to do next. Before changing another UART setting, I should probably hold on to the environment that was actually showing me something.

Debian it is, for now.

## I cared more about the kernel than the distro name

I hadn't planned to use Debian from the beginning.

I started with Raspberry Pi OS, looked at other kernel trees while trying to get closer to upstream, and explored the Arch Linux ARM setup. I looked at Armbian too.

But I kept coming back to the same question.

“Which kernel is actually inside this image?”

Changing the distribution name wouldn't necessarily give me the kernel environment I wanted. Having Debian-based userspace and building the kernel from a particular source tree are separate things.

Raspberry Pi OS is Debian-based too. Does that mean Debian's own Pi image uses the same Raspberry Pi kernel?

I went back and checked.

The image I picked was Debian's `raspi-arm64` daily image. The Pi 5 path I found at the time was Forky. I followed the Raspberry Pi image instructions on the Debian Wiki, rather than grabbing something just because it had Debian in the name. [Debian Raspberry Pi image guide](https://wiki.debian.org/RaspberryPiImages)

What interested me was having a generic ARM64 kernel as the starting point for the experiments.

## Debian doesn't mean vanilla, though

Another distinction I didn't want to gloss over.

The Debian kernel isn't untouched upstream source. Debian applies patches and uses its own build configuration. Its distributed kernel source is based on upstream source with Debian patches applied. [Debian Kernel Handbook](https://kernel-team.pages.debian.net/kernel-handbook/ch-source.html)

So a booting Debian image doesn't mean my checkout of `torvalds/linux` will boot after copying a few settings.

Sigh. I had wanted to skip these intermediate steps. Build upstream, put it on the board, get on with the work.

Now an intermediate step was exactly what I needed.

There was a kernel that booted, and I could follow it back to its source and configuration. That gave me something to compare my own build against.

For the moment, that mattered more.

## HDMI first

I haven't given up on UART. I still want UART and Ethernet connected to the PC so I can watch logs and move files around.

Trying to get all of that working at once had tangled up the experiments, though.

Was the new kernel failing to boot, or was it running without a working GPIO UART console? If networking didn't appear either, was that a driver problem or userspace configuration?

With no output, everything became a suspect.

The Debian image, on the other hand, had shown me an HDMI login prompt. I had direct evidence that this particular combination reached userspace.

Fine. Let's look at HDMI first this time.

```text
Debian image
    ↓
Confirm HDMI login prompt
    ↓
Build the corresponding source and configuration
    ↓
Check that my own build boots over HDMI too
    ↓
Then work on GPIO UART
```

That made the immediate goal smaller.

I didn't need every peripheral working right away. I needed a first reference point for checking whether a kernel I'd built was actually running.

## This time, don't trim the config first

Starting with a generic `defconfig` sounded clean. Enable what I need, leave out what I don't.

But if I don't yet know which parts I need, stripping things out can just create more reasons for a boot to fail.

I'd rather change the order this time.

First, get the configuration of the Debian kernel that already boots. Debian's installed kernel configuration can usually be found using the running kernel's release name. [Debian Kernel FAQ](https://wiki.debian.org/KernelFAQ)

```bash
uname -r
ls -l /boot/config-$(uname -r)
```

Then obtain the corresponding source and build it under conditions as close as practical to that baseline.

No UART patches at the beginning. No tidying up a dozen options while I'm there. I want a way to distinguish my own build, but otherwise I'd like to keep the functional configuration intact.

I also need to record the combination of kernel image, DTB, modules, and initramfs. I don't want to replace only `Image`, leave everything else at a different version, and then try to make sense of the result.

The first question is fairly modest:

> The distributed kernel boots. Does a kernel I build from the corresponding source and configuration boot too?

Once I know that, the next change should be easier to evaluate.

## Why Debian, specifically?

For my situation, it came down to three things.

First, **I'd seen it boot over HDMI on my own board.** I needed the environment that had already shown me a login prompt, more than another combination someone else said would work.

Second, **I could trace the source and configuration.** I wanted to go from the distributed binary back to its inputs, and then forward again to my own build.

Third, **it gave me stages on the way to upstream.** Reproduce the Debian kernel first, then investigate the differences from upstream source. At this point, that seemed more manageable than taking on every difference at once.

This isn't an argument that Debian is the best distro for every Pi experiment. The image I downloaded was a daily build. I wasn't choosing it on the assumption that “Debian stable is reliable.” This wasn't Debian stable.

I needed a working reference point.

## And then I got stuck at login

Of course, getting a login prompt didn't make everything straightforward.

I'd been told this image allowed local root login without a password. I entered `root`, expecting to get in.

Back to `login:`.

…Really? Login is the problem now?

Eventually, I set a root password and logged in with it. That worked.

Wait, wasn't this supposed to work without one?

I wondered whether it was a bug in the daily image. I haven't established the cause, though. The account state or login configuration may simply have differed from what I expected. What I can actually record is that **passwordless login didn't work on the image I tested, and login worked after I set a password.**

At least this was different from the earlier silence. There was a display, a login prompt, and a response to input. I could separate the login problem from the kernel boot question.

Now I have a Debian environment that boots and lets me log in. I'll preserve that state, then build the corresponding kernel source and configuration and check the result over HDMI.

GPIO UART comes after that.

Still a few steps away from the patch work I originally wanted to do. But at least I'm deciding what to compare against before changing the next setting.
