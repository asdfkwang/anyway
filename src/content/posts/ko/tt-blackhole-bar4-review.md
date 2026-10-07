---
title: 'TT 실험일지 1 — BAR4를 지웠는데, 왜 안 된다는 걸까?'
description: 'Tenstorrent Blackhole의 32 GiB BAR4 패치와 PCI 리뷰를 tt-kmd 코드로 따라갔다. TT 드라이버에서 동작한다는 것과 하드웨어 BAR를 안전하게 다룬다는 것 사이의 차이.'
lang: ko
translationKey: tt-blackhole-bar4-review
publishedAt: 2026-10-07
tags: [Tenstorrent, Linux, Kernel, PCIe, TLB, Firmware, Upstream]
---

Tenstorrent는 원래 관심을 갖고 보던 회사였다. 여기서는 줄여서 TT라고 부르려고 한다.

리눅스 커널에 기여해보고 싶다는 생각도 있었으니, 자연스럽게 TT의 upstream 작업을 찾아보게 됐다. SoC 지원도 있었고, Blackhole 카드의 PCI 패치도 있었다.

이번에 눈에 들어온 것은 PCI 쪽이었다. Blackhole의 BAR4가 너무 커서 장치를 사용할 수 없는 시스템이 있고, 그 BAR를 Linux에서 지우자는 패치였다.

그런데 PCI 메인테이너가 문제를 제기했다.

TT 쪽에서는 자기 드라이버가 동작한다고 한다. `lspci`에서도 BAR4가 사라졌다. 그럼 무엇이 아직 잘못된 걸까?

리뷰만 읽고 넘어가기에는 궁금했다. 그래서 실제 드라이버인 `tt-kmd`를 같이 보기 시작했다.

## 32 GiB는 호스트 RAM을 달라는 뜻이 아니었다

먼저 어떤 공간이 부족한지부터 구분해야 했다.

PCI BAR는 호스트가 장치의 메모리나 레지스터에 접근할 주소 영역을 나타낸다. 큰 BAR를 할당한다고 그만큼의 호스트 RAM을 소비하는 것은 아니다. 호스트 브리지와 그 아래 PCI 브리지들이 해당 MMIO 주소 범위를 수용하고 장치로 전달할 수 있어야 한다.

2026년 8월 24일 Anirudh Srinivasan이 보낸 [v1 패치](https://lists.openwall.net/linux-kernel/2026/08/24/1853)는 Blackhole의 32 GiB BAR4가 작은 host aperture에 들어가지 않는 문제를 다룬다. 패치에 첨부된 로그에서는 BAR4뿐 아니라 BAR0와 BAR2의 할당도 실패했다. 브리지 아래 장치들의 BAR를 수용할 window를 만들다가 큰 BAR4 때문에 같이 막힌 것이다.

패치 로그의 크기를 정리하면 이렇다.

| BAR | 로그에 나타난 크기 |
| --- | --- |
| BAR0 | 512 MiB |
| BAR2 | 1 MiB |
| BAR4 | 32 GiB |

참고로 패치 설명 문장에는 BAR0·BAR2가 256 MiB·2 MiB라고 적혀 있지만, 같은 메일의 실제 로그에는 512 MiB·1 MiB가 나온다. 이 글에서는 로그의 값을 사용한다.

BAR4 하나만 포기하면 나머지를 사용할 수 있을 것처럼 보였다.

## 패치는 Linux의 리소스 기록을 지웠다

제안된 quirk는 root bus의 메모리 window들을 확인한다. BAR4보다 크거나 같은 window가 하나라도 있으면 그대로 두고, 모든 window가 더 작으면 BAR4의 리소스 기록을 지운다. 핵심 변경은 세 줄이다.

```c
res->start = 0;
res->end = 0;
res->flags = 0;
```

여기서 `res`는 `&pdev->resource[4]`다. 장치의 PCI configuration space에 있는 BAR 레지스터에 쓰는 코드가 아니다. Linux가 관리하는 `struct resource`를 비운다. [패치 코드](https://lists.openwall.net/linux-kernel/2026/08/24/1853)

리소스 할당에서 BAR4를 제외하면 작은 BAR들만으로 브리지 window를 구성할 수 있다. 패치 작성자는 4 GiB의 BAR 공간을 가진 Spacemit-K3에서 `tt-smi`와 `tt-bh-linux`가 동작했다고 보고했다. 내가 재현한 결과는 아니다.

조건 자체에도 범위가 있었다. 큰 window가 하나 있다고 여러 카드가 모두 들어가는 것은 아니다. [커버레터](https://lists.openwall.net/linux-kernel/2026/08/24/1833)도 카드 하나는 되지만 여러 개는 실패하는 상황까지 처리하지 못한다고 설명한다. 이 quirk의 판단은 전체 장치를 배치해본 결과가 아니라 window와 BAR4의 크기 비교다.

그래도 첫 번째 질문은 남았다. 실제 TT 드라이버는 BAR4 없이 어떻게 동작할 수 있었을까?

## tt-kmd는 처음부터 BAR4 전체를 매핑하지 않는다

이번에 읽은 KMD 기준은 [`083c0399`](https://github.com/tenstorrent/tt-kmd/tree/083c0399c0e822bfe9cbf104535fcf60e2f883c3), 2026년 9월 25일 커밋이다. 8월의 리뷰에서 사용한 모듈과 동일한 버전이라고 가정하지 않았다. 아래는 이 소스로 리뷰의 쟁점을 따라간 분석이다.

[`tenstorrent_pci_probe()`](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/enumerate.c#L258)를 읽으면 대략 다음 순서다.

```text
PCI 코어가 발견한 장치의 probe
    → pci_enable_device()
    → 장치별 상태와 TLB 수 초기화
    → DMA 설정 / pci_set_master() / 인터럽트 설정
    → Blackhole의 init_device()
    → init_hardware()
    → 장치 등록
```

Blackhole의 `init_device`는 [`blackhole_init()`](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/blackhole.c#L666)으로 연결된다. 여기서 커널이 초기화용으로 매핑하는 것은 BAR0의 TLB 설정 레지스터, 커널용 TLB window, NOC2AXI 설정 영역과 BAR2다.

| 초기화 매핑 | BAR | 호출 |
| --- | --- | --- |
| TLB 설정 레지스터 | BAR0 | `pci_iomap_range()` |
| 커널용 TLB window | BAR0 | `pci_iomap_range()` |
| NOC2AXI 설정 영역 | BAR0 | `pci_iomap_range()` |
| BAR2 영역 | BAR2 | `pci_iomap()` |

BAR0에 있는 2 MiB window 하나를 커널용으로 예약하는 코드도 이어진다. 이 초기화 매핑 자체는 BAR4를 요구하지 않는다.

이걸 보니 “우리 드라이버에서는 문제없었다”는 답이 조금 이해됐다. 필요한 BAR0·BAR2를 확보하고 BAR4를 쓰지 않는 경로를 실행했다면 동작을 관찰할 수 있다. 다만 메일의 테스트가 정확히 어떤 경로를 실행했는지는 이 소스만으로 알 수 없다.

## 그렇다고 BAR4가 아무 용도 없는 공간은 아니었다

같은 파일에는 BAR4의 역할도 드러난다. [`blackhole_describe_tlb()`](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/blackhole.c#L861)는 2 MiB TLB window를 BAR0에, 4 GiB TLB window를 BAR4에 연결한다.

여기서 TLB는 호스트에서 들어오는 접근을 장치 내부의 NOC 주소로 연결하는 window다. 호스트 CPU의 페이지 테이블 TLB와는 별도로, TT 장치의 주소 변환 창을 말한다.

BAR4의 기본 구성은 **4 GiB window 8개, 총 32 GiB**다. 카드 메모리 용량과 같은 숫자가 보이더라도 이것을 곧바로 “카드 DRAM 전체의 고정 직접 매핑”으로 해석하면 안 된다. window의 대상은 TLB 설정으로 정한다.

더 흥미로운 코드는 `blackhole_init()` 앞부분에 있었다.

```c
resource_size_t bar4_len = pci_resource_len(tt_dev->pdev, 4);
tt_dev->tlb_counts[1] = bar4_len / TLB_4G_WINDOW_SIZE;
```

드라이버는 실제 리소스 길이로 사용할 4 GiB window 수를 계산한다. 부분 window는 제공하지 않는다.

| Linux가 보고 있는 BAR4 길이 | 제공할 4 GiB window 수 |
| --- | --- |
| 32 GiB | 8 |
| 16 GiB | 4 |
| 4 GiB | 1 |
| 0 | 0 |

[`tlb.c`의 할당 함수](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/tlb.c#L9)도 이 장치별 수를 사용한다. 4 GiB window 수가 0이면 해당 크기의 할당은 `-EINVAL`로 실패한다.

사용자 공간에 BAR를 보여주는 경로도 확인했다. [`ioctl_query_mappings()`](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/memory.c#L381)는 BAR4 길이가 0보다 클 때 UC·WC mapping 정보를 반환한다. [`tenstorrent_mmap()`](https://github.com/tenstorrent/tt-kmd/blob/083c0399c0e822bfe9cbf104535fcf60e2f883c3/memory.c#L1648)에는 BAR4를 사용자 공간에 매핑하는 분기가 있고, TLB mapping 경로에는 BAR 길이를 넘는 요청을 거절하는 검사도 있다.

즉 BAR4는 선택적으로 사용할 수 있는 큰 접근 창이다. 이 KMD에는 작은 BAR4를 처리하고 없는 window를 제공하지 않는 코드가 있다. 그렇다고 모든 UMD와 애플리케이션이 BAR4 없이 동작한다는 결론까지 나온 것은 아니다.

## 메인테이너가 본 것은 그보다 앞의 단계였다

8월 26일 [Bjorn Helgaas의 리뷰](https://lists.openwall.net/linux-kernel/2026/08/26/1922)는 Linux의 기록을 비워도 하드웨어 BAR는 남아 있다는 점을 지적했다. 이어서 장치 활성화와 잘못된 주소 매핑을 문제로 들고, 장치 고유의 방법으로 실제 BAR를 비활성화할 수 있는지 물었다.

그 말을 KMD에 대입하면 맨 앞의 호출이 다시 보인다.

```c
if (pci_enable_device(dev) < 0)
    return -EIO;
```

이 호출은 `blackhole_init()`보다 먼저 실행된다. 그 뒤에 BAR4의 TLB 수를 0으로 계산하거나 mapping 요청을 거절하는 것으로는 하드웨어의 BAR decode 상태가 바뀌지 않는다.

PCI 코어 쪽도 읽었다. 호출과 리소스 검사를 확인한 기준은 **Linux v6.8**이다. v1 패치의 정확한 기반 트리나 테스트 커널을 재현한 것은 아니다.

[`pci_enable_device_flags()`](https://github.com/torvalds/linux/blob/v6.8/drivers/pci/pci.c#L2106)는 `dev->resource[i].flags`를 보고 활성화할 리소스의 mask를 만든다. flags가 0이 된 BAR4는 이 mask에서 빠진다.

일반적인 활성화 경로의 [`pci_enable_resources()`](https://github.com/torvalds/linux/blob/v6.8/drivers/pci/setup-res.c#L483)는 선택된 리소스의 할당 상태를 검사하고, 메모리 리소스가 있으면 `PCI_COMMAND_MEMORY`를 켠다. 아키텍처별 `pcibios_enable_device()` 구현은 별도로 확인해야 하지만, 리뷰가 문제 삼은 구조는 여기서 볼 수 있다.

이 비트는 PCI function의 메모리 접근 응답을 허용하는 비트다. BAR0와 BAR2만 골라 켜고 BAR4만 끄는 개별 BAR 스위치가 아니다. 따라서 BAR0·BAR2를 사용하려고 memory decoding을 켜면, 하드웨어에 남아 있는 BAR4도 그 설정의 영향을 받는다.

`pci_set_master()`는 또 다른 설정이다. 장치가 호스트 쪽으로 트랜잭션을 시작할 수 있도록 bus master 비트를 켠다. 이번 리뷰의 memory decoding 문제와 DMA 허용을 섞어서 생각하면 안 된다.

quirk 이후의 상태를 그려보면 이렇다.

```text
Linux의 pdev->resource[4]       장치의 PCI configuration / BAR decode
-----------------------       --------------------------------------
start = 0                     quirk에서 쓰지 않음
end   = 0                     실제 BAR4가 비활성화됐다는 근거 없음
flags = 0                     이후 function의 memory decoding은 활성화
```

소프트웨어에서 제외한 리소스가 하드웨어에서도 제외됐다는 보장이 빠져 있었다.

여기서 “그러면 KMD가 무조건 물리 주소 0을 매핑한다”라고 쓰면 또 잘못된 분석이 된다. 앞에서 본 KMD 경로에는 길이와 window 수 검사들이 있고, mapping API 자체의 검증도 고려해야 한다. 리뷰의 잘못된 매핑 사례는 이런 불일치가 만드는 위험을 설명한 것이다. 이 글에서 해당 quirk로 현재 KMD의 실패를 재현한 것은 아니다.

실제 잘못된 BAR 주소가 어떤 영향을 주는지도 호스트의 주소 라우팅과 endpoint 구현에 달려 있다. 확실한 것은 세 줄의 `struct resource` 변경이 하드웨어 비활성화를 수행하지 않는다는 점이다.

## lspci에서 사라졌다는 것은 무엇을 확인한 걸까

TT 쪽 답변에서는 `lspci`에 BAR4가 표시되지 않고 자기 드라이버가 동작한다고 했다. Bjorn은 [후속 답변](https://lists.openwall.net/linux-kernel/2026/08/26/1993)에서 기본 출력이 커널의 리소스 정보를 반영할 수 있으므로, 출력에서 사라지는 것과 장치 상태가 바뀌는 것은 별개라고 설명했다.

내가 이 관찰에서 받아들일 수 있는 것은 Linux가 BAR4를 리소스로 보여주지 않는다는 것까지다. endpoint가 더 이상 BAR4 주소 범위에 응답하지 않는다는 검증은 따로 필요하다.

KMD의 `pci_resource_len()`도 비슷하다. 이것은 하드웨어의 BAR 크기를 매번 다시 측정하는 함수가 아니다. [Linux v6.8의 정의](https://github.com/torvalds/linux/blob/v6.8/include/linux/pci.h#L2136)는 `dev->resource[]`의 값을 사용한다. 그러니 quirk가 이 기록을 비우면 KMD 역시 길이 0을 보고 window를 제공하지 않을 수 있다.

그 동작은 드라이버의 방어에 도움이 된다. 하지만 하드웨어를 바꿨다는 증거가 될 수는 없다. 둘이 같은 기록을 보고 있기 때문이다.

## TT도 이미 BAR 가정을 고친 기록이 있었다

현재 코드만 보면 처음부터 유연한 설계였던 것처럼 느껴진다. 이력이 조금 달랐다.

2025년 11월 반영된 [`blackhole: Support small BAR4 configurations`](https://github.com/tenstorrent/tt-kmd/commit/ee0cdfe8a976230c17253d0f1e05f53a0e12e8bf)는 기존 KMD가 BAR4를 항상 32 GiB, 4 GiB window를 항상 8개로 가정했다고 설명한다. CMFW가 자원이 부족한 시스템을 위해 BAR4를 줄일 수 있으므로, 실제 길이에 맞춰 window 수와 테스트를 바꾼 커밋이다.

2026년 1월의 [`Fail gracefully when PCI BARs are unassigned`](https://github.com/tenstorrent/tt-kmd/commit/d9169f115abf320d86377b01289ab7bfb61338ad)에는 더 직접적인 기록도 있었다. BAR가 할당되지 않았을 때 TLB mmap이 물리 주소 0을 매핑하려 했다는 설명과, 이를 막는 길이 검사가 들어 있다. 같은 커밋의 reset-state crash 사례는 Wormhole에 관한 것이므로 Blackhole의 동일한 버그로 옮겨 읽지는 않았다.

이것은 현재 코드에 그대로 남은 버그를 찾아냈다는 이야기가 아니다. TT 스택도 “기본 크기일 것이다”, “BAR는 할당됐을 것이다”라는 가정을 수정해온 기록이다.

내가 보기에는 이번 문제를 이해하는 데 이 이력이 꽤 중요했다. KMD가 작은 BAR에 적응하는 일과, PCI 코어가 endpoint의 실제 상태를 올바르게 관리하는 일이 각각 필요하다는 것을 보여주니까.

## 그러면 펌웨어에서 줄이면 되는 걸까?

여기까지 보면 다음 질문은 자연스럽다. 장치가 처음부터 작은 BAR4를 제시하면 어떨까?

공개 펌웨어에도 단서가 있다. `tt-system-firmware`의 `v19.11.0`에서 [P150B 설정](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/boards/tenstorrent/tt_blackhole/spirom_data_tables/P150B/fw_table.txt#L53)은 MiB 단위로 BAR0 512, BAR2 1, BAR4 32768을 지정한다. [`update_bar4_size.py`](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/scripts/update_bar4_size.py#L78)는 firmware bundle의 BAR4 설정을 바꾸며, 0을 통한 비활성화와 적용을 위한 cold reboot를 안내한다.

[`pcie.c`](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/pcie.c#L195)에서는 이 설정을 `region4_mask`로 변환해 카드의 PCIe 컨트롤러 초기화에 넘기는 흐름을 확인할 수 있다. 단순히 Linux 드라이버가 붙은 다음에만 크기를 바꾸는 기능으로 볼 근거는 없다.

다만 컨트롤러 초기화 함수 `CntlInitV2()`는 [바이너리 라이브러리와 연결된다](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/CMakeLists.txt#L73). 실제 레지스터 설정과 링크 활성화의 순서를 공개 wrapper만으로 끝까지 확인한 것은 아니다. recovery 경로가 기본 설정을 사용한다는 점도 남는다.

그래서 지금의 판단은 이 정도다. **호스트가 BAR 크기를 확인할 때 실제 endpoint가 작은 BAR 또는 비활성화된 BAR를 제시하게 하는 방향은 조사할 근거가 있다.** 어떤 카드·펌웨어·reset 경로에서 보장되는지, 필요한 사용자 공간 소프트웨어가 줄어든 window로 동작하는지는 실험과 확인이 필요하다.

이 기능이 있다는 이유만으로 quirk가 불필요하다거나, TT가 이미 모든 호스트의 할당 문제를 해결했다고 말할 수는 없다. 기존 펌웨어와 카드 여러 개의 구성, 배포 방법까지 함께 봐야 한다.

`drivers/accel/`에 드라이버를 넣는 것도 이 앞단의 할당 문제를 자동으로 해결하지 않는다. [PCI 계층이 장치를 발견한 뒤 드라이버에 알리는 구조](https://docs.kernel.org/PCI/pci.html#structure-of-pci-drivers)에서, 드라이버가 사용할 수 있는 리소스를 확보하는 문제는 여전히 남는다.

## 첫 기록에 남길 질문

처음에는 안 쓰는 큰 BAR를 지우면 되는 문제처럼 보였다. KMD를 읽으니 그 BAR가 제공하는 기능과, 드라이버가 없어도 버티는 이유가 보였다. PCI 코어까지 따라가니 메인테이너가 하드웨어 상태를 물은 이유도 조금 이해됐다.

다음으로 확인하고 싶은 것은 세 가지다.

- firmware 설정을 바꾼 뒤 cold boot에서 endpoint가 실제로 어떤 BAR4를 제시하는가.
- 정상 부팅과 recovery·reset에서 그 상태가 어떻게 유지되거나 바뀌는가.
- 그 상태에서 KMD뿐 아니라 내가 사용할 UMD와 애플리케이션도 동작하는가.

이번 글은 패치와 소스 분석의 기록이다. 주소 공간이 부족한 호스트에서 quirk나 firmware 변경을 직접 재현한 결과는 아직 없다.

커널에 뭔가 기여해보고 싶어서 패치를 찾아봤는데, 이제는 무엇을 측정해야 할지부터 조금 보이기 시작했다. TT 쪽 기록은 여기서 시작하려고 한다.

다음 기록: [TT 실험일지 2 — Blackhole 클라우드를 받았다](../tt-blackhole-cloud-access/)
