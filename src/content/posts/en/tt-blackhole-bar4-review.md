---
title: 'TT Lab Notes 1 — Why Is Hiding BAR4 Not Enough?'
description: 'Reading tt-kmd alongside the Blackhole 32 GiB BAR4 patch and PCI review. Why a working TT driver does not establish that an ignored hardware BAR is safe.'
lang: en
translationKey: tt-blackhole-bar4-review
publishedAt: 2026-10-07
tags: [Tenstorrent, Linux, Kernel, PCIe, TLB, Firmware, Upstream]
aiSummary: |
  - Scope: First Tenstorrent lab note, analyzing the August 24, 2026 Blackhole PCI quirk v1 and August 26 review through tt-kmd source. No hardware reproduction of the quirk or firmware changes.
  - Source baseline: tt-kmd commit 083c0399c0e822bfe9cbf104535fcf60e2f883c3 from September 25, 2026; Linux v6.8 for PCI enable/resource helper semantics; tt-system-firmware v19.11.0. These do not establish the exact driver or kernel used in the mailing-list test.
  - Host problem: A 32 GiB BAR4 can prevent bridge-window allocation and leave BAR0/BAR2 unassigned on hosts with small apertures. The patch log shows BAR0 512 MiB and BAR2 1 MiB, despite different sizes in its prose. BAR space is MMIO address space, not host RAM consumption.
  - Quirk: Clears pdev->resource[4].start/end/flags when every root memory window is smaller than BAR4. It changes Linux bookkeeping without disabling the endpoint BAR, and does not solve all multi-card allocation cases.
  - KMD: Probe calls pci_enable_device before blackhole_init. Initial Blackhole mappings use BAR0/BAR2. BAR4 provides up to eight configurable 4 GiB inbound NOC TLB windows; their count is derived from pci_resource_len. Query/mmap paths expose BAR4 when available and include range checks.
  - Review interpretation: Resource flags drive the PCI enable mask, but PCI_COMMAND_MEMORY controls memory decoding for the function rather than individually disabling BAR4. KMD resource checks and disappearance from lspci do not prove hardware decode is disabled. This analysis does not demonstrate a current KMD mapping exploit.
  - History: ee0cdfe8a976230c17253d0f1e05f53a0e12e8bf added small BAR4 support in November 2025. d9169f115abf320d86377b01289ab7bfb61338ad added checks for unassigned BARs in January 2026; its reset-state crash example concerns Wormhole.
  - Firmware: BAR4 size is configurable in the bundle and passed into controller initialization; the update script documents size 0 and a cold reboot. The controller implementation uses a binary library, and recovery/default behavior and actual host enumeration remain to be validated.
  - Next: Measure endpoint BAR advertisement after a firmware change and cold boot, across recovery/reset paths, and verify the chosen KMD/UMD/application stack. Moving a driver under accel does not by itself resolve initial PCI allocation.
---

I had been interested in Tenstorrent for a while. I'll call it TT here.

I also wanted to contribute to the Linux kernel, so I started looking at TT's upstream work. There was SoC support, and there were PCI patches for Blackhole cards.

The PCI patch caught my attention. Some hosts cannot use the card because BAR4 is too large. The proposed workaround was to remove that BAR from Linux's resource view.

The PCI maintainer raised a problem with it.

TT reported that its driver worked. BAR4 had disappeared from `lspci`. What was still wrong?

I wanted to understand the review against the actual driver, so I started reading `tt-kmd` alongside it.

## The card was not asking for 32 GiB of host RAM

First, I needed to distinguish the kinds of memory involved.

A PCI BAR describes an address region through which the host accesses device memory or registers. Allocating a large BAR does not consume that amount of host RAM. The host bridge and downstream PCI bridges need suitable MMIO address windows to route those accesses to the device.

Anirudh Srinivasan's [August 24, 2026 v1 patch](https://lists.openwall.net/linux-kernel/2026/08/24/1853) addresses Blackhole's 32 GiB BAR4 on hosts with small apertures. The attached log shows BAR0 and BAR2 failing allocation as well. The bridge could not obtain a window accommodating the downstream BAR requirements.

These are the sizes in that log:

| BAR | Size in the log |
| --- | --- |
| BAR0 | 512 MiB |
| BAR2 | 1 MiB |
| BAR4 | 32 GiB |

The patch's prose gives 256 MiB and 2 MiB for BAR0 and BAR2, whereas its log gives 512 MiB and 1 MiB. I use the logged sizes here.

Giving up BAR4 appeared to leave room for the smaller BARs.

## The patch erased Linux's resource record

The proposed quirk walks the root bus's memory windows. It leaves BAR4 alone if any window is at least as large. If all are smaller, it clears the BAR4 resource record. The essential change is three lines:

```c
res->start = 0;
res->end = 0;
res->flags = 0;
```

Here, `res` is `&pdev->resource[4]`. This changes Linux's `struct resource`; it does not write the hardware BAR register in PCI configuration space. [Patch code](https://lists.openwall.net/linux-kernel/2026/08/24/1853)

Excluding BAR4 lets resource allocation construct a bridge window for the smaller BARs. The author reported working `tt-smi` and `tt-bh-linux` on a Spacemit-K3 with 4 GiB of BAR space. I have not reproduced that test.

The condition also has a limited scope. A large window does not guarantee room for multiple cards. The [cover letter](https://lists.openwall.net/linux-kernel/2026/08/24/1833) explicitly acknowledges that case. This is a size comparison, rather than the result of attempting to place all devices.

Still, how could the TT driver operate without BAR4?

## tt-kmd does not initially map the entire BAR4

My KMD baseline is [`083c0399`](https://github.com/tenstorrent/tt-kmd/tree/083c0399c0e822bfe9cbf104535fcf60e2f883c3), a September 25, 2026 commit. I do not assume it matches the module used in the August discussion. This is a source analysis of the review's concerns.

[`tenstorrent_pci_probe()`](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/enumerate.c#L258) follows roughly this sequence:

```text
Probe for a device discovered by the PCI core
    → pci_enable_device()
    → initialize device state and TLB counts
    → DMA setup / pci_set_master() / interrupt setup
    → Blackhole init_device()
    → init_hardware()
    → register the device
```

Blackhole's `init_device` points to [`blackhole_init()`](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/blackhole.c#L666). Its initial kernel mappings cover the TLB configuration registers, a kernel TLB window and NOC2AXI configuration in BAR0, plus BAR2:

| Initial mapping | BAR | Call |
| --- | --- | --- |
| TLB configuration registers | BAR0 | `pci_iomap_range()` |
| Kernel TLB window | BAR0 | `pci_iomap_range()` |
| NOC2AXI configuration | BAR0 | `pci_iomap_range()` |
| BAR2 region | BAR2 | `pci_iomap()` |

It also reserves one 2 MiB window in BAR0 for the kernel. These initial mappings do not require BAR4.

That helps explain how a test could work. A path using BAR0 and BAR2, without requesting BAR4 facilities, could operate after those resources became available. The source alone does not tell me exactly which paths the mailing-list test exercised.

## BAR4 still provides a real feature

[`blackhole_describe_tlb()`](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/blackhole.c#L861) identifies what the BARs provide: 2 MiB TLB windows in BAR0 and 4 GiB TLB windows in BAR4.

These are device address-translation windows routing inbound host accesses to the internal NOC. They are distinct from the host CPU's page-table TLB.

The nominal BAR4 configuration is **eight 4 GiB windows, totaling 32 GiB**. A matching card-memory capacity would not establish a fixed direct mapping of all card DRAM. The TLB configuration selects each window's destination.

At the beginning of `blackhole_init()`, the driver calculates the available window count:

```c
resource_size_t bar4_len = pci_resource_len(tt_dev->pdev, 4);
tt_dev->tlb_counts[1] = bar4_len / TLB_4G_WINDOW_SIZE;
```

Only complete windows are provided.

| BAR4 length in Linux's resource view | Available 4 GiB windows |
| --- | --- |
| 32 GiB | 8 |
| 16 GiB | 4 |
| 4 GiB | 1 |
| 0 | 0 |

The [TLB allocator](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/tlb.c#L9) uses those per-device counts. A request for a 4 GiB window fails with `-EINVAL` when its count is zero.

The userspace mapping interface follows the resource view too. [`ioctl_query_mappings()`](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/memory.c#L381) reports BAR4 UC and WC mappings when its length is positive. [`tenstorrent_mmap()`](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/memory.c#L1648) has BAR4 mapping branches, and the TLB mapping path rejects requests exceeding the BAR length.

BAR4 provides optional large access windows. This KMD adapts to smaller BAR4 configurations and avoids offering unavailable windows. That does not establish compatibility for every UMD and application.

## The maintainer was looking at an earlier boundary

In his [August 26 review](https://lists.openwall.net/linux-kernel/2026/08/26/1922), Bjorn Helgaas pointed out that clearing Linux's record leaves the hardware BAR in place. He raised device-enable and invalid-mapping concerns and asked about a device-specific way to disable the BAR in hardware.

Looking back at KMD, the early call matters:

```c
if (pci_enable_device(dev) < 0)
    return -EIO;
```

It runs before `blackhole_init()`. Setting the later TLB count to zero or rejecting mapping requests does not change hardware BAR decoding.

I also read the PCI core. My baseline for the enable and resource helpers is **Linux v6.8**, rather than a reproduction of the v1 patch's exact base tree or test kernel.

[`pci_enable_device_flags()`](https://github.com/torvalds/linux/blob/v6.8/drivers/pci/pci.c#L2106) builds its resource mask from `dev->resource[i].flags`. BAR4 disappears from that mask after its flags are cleared.

In the generic enable path, [`pci_enable_resources()`](https://github.com/torvalds/linux/blob/v6.8/drivers/pci/setup-res.c#L483) checks the selected resources and sets `PCI_COMMAND_MEMORY` for memory resources. Architecture-specific `pcibios_enable_device()` implementations need separate inspection, but this shows the structure behind the review.

That bit enables memory decoding for the PCI function. It is not an individual switch that enables BAR0 and BAR2 while disabling BAR4. Enabling memory decoding to use those smaller BARs also affects a hardware BAR4 that still exists.

`pci_set_master()` is a separate setting: it enables bus mastering so the device can initiate transactions. DMA permission and the memory-decoding issue in this review need separate reasoning.

After the quirk, the two views look like this:

```text
Linux pdev->resource[4]        Device configuration / BAR decoding
----------------------        -----------------------------------
start = 0                     Not written by this quirk
end   = 0                     No demonstrated hardware BAR4 disable
flags = 0                     Function memory decoding enabled later
```

The missing guarantee is that a resource excluded in software is also excluded in hardware.

It would be wrong to conclude that this KMD necessarily maps physical address zero. Its relevant paths include length and window-count checks, and mapping APIs have their own validation. The review's mapping example illustrates the risk of inconsistent state. I have not reproduced a current KMD failure with this quirk.

The consequences of an invalid hardware BAR address also depend on host routing and endpoint behavior. What the three assignments clearly do not perform is hardware disablement.

## What did disappearance from lspci verify?

TT's response reported a working driver and no BAR4 region in `lspci`. In his [follow-up](https://lists.openwall.net/linux-kernel/2026/08/26/1993), Bjorn explained that the default output can reflect the kernel's resource information, so disappearance from the output does not establish a change to the device.

That observation supports a narrower finding: Linux no longer presents BAR4 as a resource. Whether the endpoint has stopped responding through BAR4 requires separate verification.

KMD's `pci_resource_len()` has the same limitation. It does not remeasure the hardware BAR on each call. The [Linux v6.8 definition](https://github.com/torvalds/linux/blob/v6.8/include/linux/pci.h#L2136) reads `dev->resource[]`. Clearing that record can therefore make KMD see zero length and offer no corresponding windows.

That helps the driver avoid unavailable resources. It does not prove the hardware changed: both observations rely on the same software record.

## TT had already corrected BAR assumptions

The current code can look as though it always handled variable BAR sizes. Its history says otherwise.

[`blackhole: Support small BAR4 configurations`](https://github.com/tenstorrent/tt-kmd/commit/ee0cdfe8a976230c17253d0f1e05f53a0e12e8bf), committed in November 2025, describes an earlier assumption of a 32 GiB BAR4 and eight fixed 4 GiB windows. Because CMFW can reduce BAR4 on constrained systems, it changed the window counts and tests to follow the actual length.

The January 2026 commit [`Fail gracefully when PCI BARs are unassigned`](https://github.com/tenstorrent/tt-kmd/commit/d9169f115abf320d86377b01289ab7bfb61338ad) records another relevant failure: TLB mmap could attempt to map physical address zero when BARs were unassigned. It added a length check. The reset-state crash also described in that commit concerns Wormhole; I do not treat it as the same Blackhole bug.

These are historical fixes. They show TT removing assumptions that BARs always have their nominal size or always receive an assignment.

To me, that history helps explain the boundary. Adapting KMD to a smaller BAR and making the PCI core's view consistent with the actual endpoint are separate pieces of work.

## Could firmware configure a smaller BAR instead?

That leads to the next question: what if the endpoint presents a smaller BAR4 in the first place?

Public firmware provides a concrete lead. In `tt-system-firmware` tag `v19.11.0`, the [P150B configuration](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/boards/tenstorrent/tt_blackhole/spirom_data_tables/P150B/fw_table.txt#L53) specifies BAR0 512, BAR2 1 and BAR4 32768, in MiB. [`update_bar4_size.py`](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/scripts/update_bar4_size.py#L78) modifies the bundle configuration, documents zero to disable BAR4, and says a cold reboot is required.

[`pcie.c`](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/pcie.c#L195) converts the configuration into `region4_mask` and passes it into the card's PCIe controller initialization. The public code does not support assuming this is only a change made after Linux driver binding.

However, `CntlInitV2()` is [linked from a binary library](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/CMakeLists.txt#L73). The wrapper alone does not fully reveal the order of register programming and link activation. The recovery path also uses default configuration.

My conclusion is a direction to investigate: **have the actual endpoint present a smaller or disabled BAR when the host determines its size.** Which cards, firmware and reset paths guarantee that behavior, and whether the chosen userspace stack works with fewer windows, still need verification.

Configuration support alone does not establish that a quirk is unnecessary or that all hosts' allocation problems are solved. Older firmware, multiple cards and deployment constraints matter too.

Moving a driver into `drivers/accel/` would not automatically resolve this initial allocation issue. In the [PCI discovery and driver-notification model](https://docs.kernel.org/PCI/pci.html#structure-of-pci-drivers), obtaining usable resources remains a prerequisite for the driver paths that need them.

## Questions to carry into the next experiment

At first, this looked like removing a large, unused BAR. Reading KMD showed what the BAR provides and why some paths can work without it. Reading the PCI core helped explain why the maintainer asked about hardware state.

I want to verify three things next:

- What BAR4 the endpoint actually presents during a cold boot after a firmware configuration change.
- How that state persists or changes across normal boot, recovery and reset.
- Whether the selected UMD and application work alongside KMD with that configuration.

This article records patch and source analysis. I have not reproduced the quirk or a firmware change on a host lacking enough PCI address space.

I started by looking for a kernel contribution. Now I have a clearer idea of what I need to measure first. This is where the TT notes begin.

Next: [TT Lab Notes 2 — I Got Access to a Blackhole Cloud Instance](../tt-blackhole-cloud-access/)
