---
title: 'TT Lab Notes 2 — I Got Access to a Blackhole Cloud Instance'
description: 'Contacting Tenstorrent about upstream kernel contributions led to Blackhole P150 cloud access. My first investigation traced container permissions and real BAR allocations back to firmware configuration.'
lang: en
translationKey: tt-blackhole-cloud-access
publishedAt: 2026-10-07
tags: [Tenstorrent, Linux, Kernel, PCIe, Cloud, Containers, Firmware, Upstream]
aiSummary: |
  - Context: Contacted Tenstorrent about upstream Linux kernel contributions. Emailed Anirudh Srinivasan and Joel Smith on September 27 without a reply at the time of these notes; Jeremy subsequently enabled access to launch cloud instances.
  - Console snapshot: dev-bhp150, Blackhole P150, created by kwang, 1h ago, Running, Expires in 1d. The console displayed 32 GB LPDDR5; its relationship to actual card memory was not verified. Instance expiry does not establish account access duration or storage persistence.
  - Observation date: October 7, 2026. Source: prior cloud investigation notes, rather than a new live session. No firmware changes, PCI config writes, module replacement, device resets or reboots were performed in the recorded investigation.
  - Access: Browser code-server in Ubuntu 22.04 userspace. sudo -n id succeeded as uid 0, but sudo dmesg was denied. kubepods/cri-containerd cgroup paths, read-only sysfs and missing host-management capabilities identify a constrained container environment. The underlying node's physical-server/VM status was not established.
  - SSH: sshd executable existed but no running daemon; localhost TCP 22 refused connections and the workload web address's external TCP 22 timed out. A separate SSH gateway was not verified. Baremetal access showed waitlist.
  - Device: /dev/tenstorrent/7 corresponded to PCI function 0000:a1:00.0 with driver tenstorrent, card type p150b and PCI ID 1e52:b140. Host kernel 6.8.0-138-generic x86_64; running KMD 2.9.0; firmware bundle 19.11.0.0; PCIe 32.0 GT/s x16. Installed packages included tt-umd 0.9.9 and tt-exalens 0.3.30; active application ioctl/backend usage was not traced.
  - BAR allocation: Read sysfs resource without lspci. BAR0 512 MiB at 0x90000000000; BAR2 1 MiB at 0x90020000000; BAR4 32 GiB at 0x8f800000000. This host already allocated BAR4, so it did not reproduce the constrained-aperture failure. Allocation does not prove application mapping or use.
  - Firmware source: tt-system-firmware v19.11.0, commit 469fd3a20009c411384caa62dc82d3e5b4149e1e. P150B PCI0 table matches the observed BAR sizes. CntlInitV2ParamInit converts BAR4 size into region4_mask and passes it into controller initialization during device Zephyr POST_KERNEL, not after host Linux probe.
  - Limits: update_bar4_size.py documents bundle configuration changes, zero to disable and a cold reboot. CntlInitV2 uses a binary library, recovery uses a 32 GiB default, standard Resizable BAR capability was not established, and changed-firmware host enumeration was not tested. Local KMD commit 083c0399 must not be assumed identical to the running 2.9.0 module.
  - Next: Obtain suitable host access, a constrained PCI aperture and cold-boot/reset control; compare actual enumeration across firmware configurations and recovery/reset paths; confirm supported KMD/UMD/application combinations with Tenstorrent.
---

In [the previous article](../tt-blackhole-bar4-review/), I read the Blackhole BAR4 patch and PCI review alongside `tt-kmd`.

That left me with questions I wanted to answer on a real device. How large was its assigned BAR4? Did that match firmware configuration? Could I test a modified kernel or driver?

So I contacted TT.

On September 27, I emailed Anirudh Srinivasan and Joel Smith about my interest in upstream kernel work and whether an external contributor could help. I had not received a reply to those emails, but during subsequent communication Jeremy enabled access to launch cloud instances.

Oh. Now I could actually look at a Blackhole.

My goal was kernel work around TT hardware: PCIe, SoC support and low-level drivers. I expected upstream contributions to take time and wanted to align with work already underway. For now, I would start with the access available and find out what it allowed.

## Wait, “Expires in 1d”?

An instance appeared in the cloud console. This was the display at the time:

| Item | Console display |
| --- | --- |
| Instance | `dev-bhp150` |
| Hardware | Blackhole P150 |
| Memory label | 32 GB LPDDR5 |
| Created by | `kwang` |
| Created | 1h ago |
| Status | Running |
| Expires | Expires in 1d |

Was this a one-day instance?

The display showed that instance expiring in a day. It did not establish how long account access would last, whether I could create another instance, or whether my files would persist.

Before spending a long time setting things up, I decided to inspect the device and environment.

“32 GB LPDDR5” was the console's label. I did not verify which part of the actual card memory configuration it represented. I recorded it separately from the 32 GiB BAR4 address region inspected later.

## Open gave me a terminal in the browser

Opening the instance brought up code-server, with an editor and terminal in the browser.

It had Ubuntu 22.04 userspace. It also had working `sudo`.

```bash
sudo -n id
```

```text
uid=0(root) gid=0(root) groups=0(root)
```

Time to look at the kernel log.

```bash
sudo -n dmesg
```

The result was `Operation not permitted`.

Root, but no kernel log?

## Working sudo did not mean control of the host

I looked more closely. `/proc/1/cgroup` contained `kubepods` and `cri-containerd`, and `/sys` was mounted read-only.

The capabilities of a process run through sudo were restricted too. They did not include `CAP_SYS_MODULE` for module management, `CAP_SYS_ADMIN` or `CAP_SYS_BOOT` for host administration and reboot, or `CAP_SYSLOG` for kernel-log access. A uid of zero did not grant all those permissions.

I was in container userspace managed through Kubernetes and containerd. The observed device-access path looked like this:

```text
Browser code-server
    ↓
Container userspace
    ↓ /dev/tenstorrent/7
Host node's tenstorrent kernel driver
    ↓
Blackhole PCIe device
```

I could run root commands inside the container. I had not obtained the host access needed to replace kernel modules or reboot the host to test PCI enumeration. This assessment came from reading capabilities and mount state; I did not try loading a module or rebooting the host.

The Baremetal access page showed waitlist status. I also could not determine whether the node underneath the container was a physical server or a VM.

I had requested hardware access for kernel work. First, I needed to understand which layer I had reached.

SSH was not immediately available either. An `sshd` executable existed, but no daemon was running. Localhost TCP port 22 refused connections, and external TCP port 22 on the workload web address timed out. I did not verify a separate SSH gateway, so the investigation used the web terminal.

## No lspci, so I used sysfs

I wanted to inspect the PCI device, but `lspci` was not installed.

Instead, I followed the class-device path in sysfs:

```bash
readlink -f /sys/class/tenstorrent/*7
```

It connected `/dev/tenstorrent/7` to PCI function `0000:a1:00.0`, with the `tenstorrent` driver bound to it.

These are the values recorded on October 7, 2026:

| Item | Observed value |
| --- | --- |
| Card type | `p150b` |
| PCI ID | `1e52:b140` |
| Host kernel | `6.8.0-138-generic`, x86_64 |
| Running KMD | `2.9.0` |
| Firmware bundle | `19.11.0.0` |
| PCIe link | `32.0 GT/s`, x16 |
| Installed Python packages | `tt-umd==0.9.9`, `tt-exalens==0.3.30` |

Installed packages did not establish which UMD backend and ioctls an actual application used. I did not trace that activity. The `tt-smi` and `tt-flash` executables were present, but I did not run them in this investigation.

## This host had already assigned BAR4

I read the BAR resources from:

```bash
cat /sys/bus/pci/devices/0000:a1:00.0/resource
```

The [Linux PCI sysfs documentation](https://docs.kernel.org/PCI/sysfs-pci.html) identifies `resource` as providing PCI resource host addresses. For each assigned BAR, I calculated its size as `end - start + 1`.

| BAR | Start address | Assigned size |
| --- | --- | --- |
| BAR0 | `0x90000000000` | 512 MiB |
| BAR2 | `0x90020000000` | 1 MiB |
| BAR4 | `0x8f800000000` | 32 GiB |

BAR4 was there. All 32 GiB had an assignment.

Unlike the constrained host discussed in the previous article, this host could allocate the large BAR4. It did not reproduce the address-space shortage.

It still gave me a real device's resource state. However, the file describes host allocation. It does not show whether a particular process mapped or used BAR4. The container did not expose `/proc/tenstorrent/7` or the corresponding debugfs path, so I could not inspect per-process mappings there either.

## I matched the source investigation to the firmware version

The next question was where this card's 32 GiB came from.

The observed bundle version was `19.11.0.0`, so I used the public repository's `v19.11.0` tag, commit [`469fd3a2`](https://github.com/tenstorrent/tt-system-firmware/tree/469fd3a20009c411384caa62dc82d3e5b4149e1e). That gave me a version baseline; I did not completely compare the running binary against the source.

The PCI0 entry in the [P150B firmware table](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/boards/tenstorrent/tt_blackhole/spirom_data_tables/P150B/fw_table.txt#L51) contained these values, in MiB:

```text
pcie_bar0_size: 512
pcie_bar2_size: 1
pcie_bar4_size: 32768
```

They matched the sizes read from the device.

Matching numbers were only part of the answer. The previous review distinguished clearing Linux's bookkeeping from changing the actual endpoint BAR. When did this configuration reach the PCIe controller?

Reading [`pcie.c`](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/pcie.c#L451) revealed this flow:

```text
pcie_init()
    → read the firmware table
    → CntlInitV2ParamInit()
    → PCIeInit()
    → PCIeInitComm()
    → CntlInitV2()
```

[`CntlInitV2ParamInit()`](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/pcie.c#L195) converts the BAR4 size into a byte mask in `region4_mask`. Zero follows the disable path; other values are rounded up to the next power of two if needed.

`pcie_init()` is registered through `SYS_INIT_APP`. The [macro definition](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/include/tenstorrent/sys_init_defines.h#L38) uses Zephyr's `POST_KERNEL` initialization stage.

That kernel is the Zephyr kernel running on the card. It does not mean the configuration happens after the host Linux driver's probe.

The source establishes that **BAR4 configuration is passed into PCIe controller initialization during card firmware boot**. It provides grounds to interpret this as a path for setting the endpoint's BAR size before host enumeration. I had not changed the configuration and tested the host's resulting enumeration.

## A configuration tool existed, and some boundaries remained

The same tag includes [`update_bar4_size.py`](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/scripts/update_bar4_size.py#L78). It changes the BAR4 size in the bundle's `cmfwcfg`, supports zero to disable it, and documents the need for a cold reboot.

The earlier question—could firmware reduce BAR4?—now had a concrete configuration file and tool behind it.

However, [`CntlInitV2()` is linked from a binary library](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/CMakeLists.txt#L73). The public wrapper shows the parameters, but does not fully expose the ordering of hardware BAR writes and link activation.

The [recovery SMC path](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/pcie.c#L469) also uses default sizes rather than the normal firmware table. This source defaults BAR4 to 32 GiB. Changing normal-boot configuration would not establish the same behavior in recovery. I also did not establish whether this feature corresponds to standard PCIe Resizable BAR capability.

KMD versions needed separate tracking. The running cloud module was `2.9.0`; the local source used in the previous article was [`083c0399`](https://github.com/tenstorrent/tt-kmd/tree/083c0399c0e822bfe9cbf104535fcf60e2f883c3). Its adjustment of 4 GiB window counts to BAR4 length does not verify the behavior of the running module and UMD combination.

## Access to the device clarified the next experiment

Initially, I thought getting a cloud device might let me begin kernel experiments straight away.

What I received was container access to Blackhole through the host's KMD. I read the device node, versions and BAR allocation, then connected the observed sizes to firmware configuration.

That helped me understand the stack. The PCI address-space shortage I wanted to study was absent on this host, and I did not yet have access for host-kernel replacement or cold-boot experiments.

Next, I want to inspect logs and configuration space on a host with a small PCI aperture. After a BAR4 configuration change, what size does the host enumerate on a cold boot? How does recovery or reset change it? Does the actual KMD, UMD and application combination work? I also need to confirm with TT whether firmware reduction is supported for that card and software combination.

The recorded investigation performed no firmware changes, PCI configuration writes, module replacements, device resets or reboots. Its results came from environment inspection and source reading.

I contacted TT because I was interested, and got an opportunity to access a real device. I appreciated that access. Now I could explain a little more clearly what observation and control I would need next.
