---
title: 'TT 실험일지 2 — Blackhole 클라우드를 받았다'
description: 'Tenstorrent에 upstream 커널 기여를 문의했고 Blackhole P150 클라우드에 접속하게 됐다. sudo와 호스트 권한의 차이를 확인하고, 실제 BAR4 크기에서 펌웨어 설정까지 따라간 첫 조사.'
lang: ko
translationKey: tt-blackhole-cloud-access
publishedAt: 2026-10-07
tags: [Tenstorrent, Linux, Kernel, PCIe, Cloud, Containers, Firmware, Upstream]
---

[지난 글](../tt-blackhole-bar4-review/)에서는 Blackhole의 BAR4 패치와 PCI 리뷰를 `tt-kmd` 코드에 대입해봤다.

코드를 읽다 보니 실제 장치에서 확인하고 싶은 것이 생겼다. BAR4가 어떤 크기로 할당되어 있는지, 펌웨어 설정과 일치하는지, 그리고 내가 바꾼 커널이나 드라이버를 시험할 수 있는지.

그래서 TT에 연락했다.

9월 27일에는 Anirudh Srinivasan과 Joel Smith에게 upstream 커널 작업에 관심이 있고, 외부 기여자가 도울 만한 부분이 있는지 메일을 보냈다. 그 메일에는 아직 답을 받지 못했지만, 이후 연락 과정에서 Jeremy가 클라우드 인스턴스를 실행할 수 있는 접근을 열어줬다.

오. 이제 Blackhole을 직접 볼 수 있겠네.

내가 하고 싶은 것은 TT 하드웨어 주변의 커널 작업이었다. PCIe나 SoC 지원, 낮은 계층의 드라이버를 이해하고 upstream에 기여해보고 싶었다. 이런 작업은 오래 걸리고, 이미 진행 중인 작업과 방향을 맞추는 것도 중요하다고 생각했다. 일단 접근할 수 있는 환경부터 받고, 무엇을 할 수 있는지 살펴보기로 했다.

## 그런데 `Expires in 1d`?

클라우드 콘솔에 인스턴스가 나타났다. 당시 화면에 보인 내용은 이랬다.

| 항목 | 콘솔 표기 |
| --- | --- |
| Instance | `dev-bhp150` |
| Hardware | Blackhole P150 |
| 메모리 표기 | 32 GB LPDDR5 |
| Created by | `kwang` |
| 생성 시점 | 1h ago |
| Status | Running |
| Expires | Expires in 1d |

잠깐. 1일짜리인가?

화면에서는 이 인스턴스의 만료가 1일 뒤로 표시돼 있었다. 계정의 접근 권한도 하루만 유지되는지, 만료 후 다시 만들 수 있는지, 작업 파일이 남는지는 이 표시만으로 알 수 없었다.

일단 오래 세팅하기 전에 장치와 환경부터 확인하기로 했다.

위의 “32 GB LPDDR5”는 콘솔의 표기다. 이번 조사에서는 이 값이 실제 카드 메모리 구성의 어떤 항목을 가리키는지 확인하지 않았다. 뒤에서 읽은 BAR4의 32 GiB 주소 공간과도 따로 구분해서 기록했다.

## Open을 누르니 브라우저 안에 터미널이 있었다

인스턴스를 열자 code-server가 나타났다. 브라우저에서 편집기와 터미널을 사용할 수 있는 환경이었다.

Ubuntu 22.04 사용자 공간이 있었고, `sudo`도 됐다.

```bash
sudo -n id
```

```text
uid=0(root) gid=0(root) groups=0(root)
```

그러면 커널 로그부터 보자.

```bash
sudo -n dmesg
```

결과는 `Operation not permitted`였다.

응? root인데 커널 로그도 못 읽는다고?

## sudo가 된다는 것과 호스트를 제어한다는 것은 달랐다

환경을 더 읽어봤다. `/proc/1/cgroup`에는 `kubepods`와 `cri-containerd`가 나타났고, `/sys`는 읽기 전용으로 마운트되어 있었다.

sudo로 실행한 프로세스의 capability도 확인했다. 커널 모듈 관리에 필요한 `CAP_SYS_MODULE`, 호스트 관리와 재부팅에 관련된 `CAP_SYS_ADMIN`·`CAP_SYS_BOOT`, 커널 로그 접근에 관련된 `CAP_SYSLOG` 등이 없었다. uid가 0이어도 프로세스에 허용된 권한은 제한되어 있었다.

내가 접속한 곳은 Kubernetes와 containerd를 사용하는 컨테이너 사용자 공간이었다. 장치를 사용하는 연결은 다음처럼 보였다.

```text
브라우저의 code-server
    ↓
컨테이너의 사용자 공간
    ↓ /dev/tenstorrent/7
호스트 노드의 tenstorrent 커널 드라이버
    ↓
Blackhole PCIe 장치
```

컨테이너 안에서는 root 명령을 실행할 수 있었다. 하지만 호스트 커널의 모듈을 교체하거나, 호스트를 재부팅하며 PCI 열거를 다시 시험하는 권한은 확보되지 않았다. 이 판단은 capability와 마운트 상태를 읽은 결과다. 확인하려고 모듈을 로드하거나 호스트를 재부팅한 것은 아니다.

Baremetal 메뉴의 접근 상태도 waitlist였다. 다만 컨테이너 아래의 호스트 노드가 물리 서버인지 VM인지는 이번 조사로 확인하지 못했다.

커널 작업을 하고 싶어서 기기를 받았는데, 먼저 내가 어느 계층에 접속한 건지부터 알아야 했다.

SSH도 바로 되는 환경은 아니었다. `sshd` 실행 파일은 있었지만 데몬이 실행 중이지 않았고, 컨테이너의 localhost 22번 포트는 connection refused였다. 현재 웹 주소의 외부 22번 포트도 timeout이었다. 별도 SSH gateway가 있는지는 확인하지 못했고, 이번 조사는 웹 터미널에서 진행했다.

## lspci가 없어서 sysfs로 갔다

장치부터 보려고 했는데 `lspci`가 설치되어 있지 않았다.

대신 sysfs에서 장치 노드와 PCI 함수를 연결했다.

```bash
readlink -f /sys/class/tenstorrent/*7
```

경로를 따라가면 `/dev/tenstorrent/7`은 `0000:a1:00.0`에 대응했다. 이 PCI 함수에는 `tenstorrent` 드라이버가 바인딩되어 있었다.

2026년 10월 7일 조사 기록에 남긴 값은 다음과 같다.

| 항목 | 관측값 |
| --- | --- |
| 카드 유형 | `p150b` |
| PCI ID | `1e52:b140` |
| 호스트 커널 | `6.8.0-138-generic`, x86_64 |
| 실행 중인 KMD | `2.9.0` |
| 펌웨어 번들 | `19.11.0.0` |
| PCIe 링크 | `32.0 GT/s`, x16 |
| 설치된 Python 패키지 | `tt-umd==0.9.9`, `tt-exalens==0.3.30` |

패키지가 있다는 사실은 확인했지만, 실제 애플리케이션이 어떤 UMD backend와 ioctl을 사용하는지 추적한 것은 아니다. `tt-smi`와 `tt-flash` 실행 파일도 있었지만 이번 조사에서는 실행하지 않았다.

## 여기서는 BAR4가 이미 할당되어 있었다

지난 글에서 궁금했던 BAR 크기는 이 파일에서 읽었다.

```bash
cat /sys/bus/pci/devices/0000:a1:00.0/resource
```

Linux의 [PCI sysfs 문서](https://docs.kernel.org/PCI/sysfs-pci.html)에 따르면 `resource`는 PCI 리소스의 호스트 주소를 제공한다. 할당된 BAR의 시작·끝 주소로 `end - start + 1`을 계산했다.

| BAR | 시작 주소 | 할당 크기 |
| --- | --- | --- |
| BAR0 | `0x90000000000` | 512 MiB |
| BAR2 | `0x90020000000` | 1 MiB |
| BAR4 | `0x8f800000000` | 32 GiB |

BAR4가 있다. 32 GiB 전체가 할당되어 있다.

지난 글의 문제가 발생한 호스트와 달리, 이 호스트에서는 큰 BAR4에 주소 공간을 배정할 수 있었다. 여기서 주소 공간 부족 문제를 재현한 것은 아니었다.

그래도 실제 카드가 어떤 리소스를 갖고 올라왔는지는 확인했다. 단, 이 파일은 호스트의 할당 상태를 보여준다. 특정 프로세스가 BAR4를 매핑했다거나, 그 공간을 실제로 사용한다는 뜻은 아니다. 컨테이너에서는 `/proc/tenstorrent/7`과 관련 debugfs 경로도 보이지 않아, 프로세스별 mapping까지 확인하지 못했다.

## 실제 펌웨어 버전에 맞춰 소스를 읽었다

이제 질문을 조금 바꿨다. 현재 카드의 32 GiB는 어디서 정해지는가?

장비에서 읽은 펌웨어 번들 버전이 `19.11.0.0`이었으므로, 공개 저장소에서는 `v19.11.0` 태그를 기준으로 읽었다. 해당 소스 커밋은 [`469fd3a2`](https://github.com/tenstorrent/tt-system-firmware/tree/469fd3a20009c411384caa62dc82d3e5b4149e1e)다. 실행 중인 바이너리를 소스와 완전히 대조한 것은 아니지만, 조사할 버전을 맞출 기준은 생겼다.

[P150B firmware table](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/boards/tenstorrent/tt_blackhole/spirom_data_tables/P150B/fw_table.txt#L51)의 PCI0 설정에 다음 값이 있었다. 단위는 MiB다.

```text
pcie_bar0_size: 512
pcie_bar2_size: 1
pcie_bar4_size: 32768
```

실제 장비에서 읽은 크기와 일치했다.

하지만 값이 같다는 것만으로 끝낼 수는 없었다. 지난 글의 리뷰에서 중요한 것은 Linux가 기록을 지우는 것과 실제 endpoint의 BAR가 바뀌는 것 사이의 차이였다. 이 설정이 언제 PCIe 컨트롤러에 들어가는지 봐야 했다.

[`pcie.c`](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/pcie.c#L451)를 따라가니 이런 흐름이 나왔다.

```text
pcie_init()
    → 펌웨어 테이블 읽기
    → CntlInitV2ParamInit()
    → PCIeInit()
    → PCIeInitComm()
    → CntlInitV2()
```

[`CntlInitV2ParamInit()`](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/pcie.c#L195)은 BAR4 크기를 바이트 단위 mask로 변환해 `region4_mask`에 넣는다. 0은 비활성화 경로로 처리하고, 다른 값은 필요하면 다음 2의 거듭제곱으로 올림한다.

그리고 `pcie_init()`은 `SYS_INIT_APP`으로 등록되어 있었다. [매크로 정의](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/include/tenstorrent/sys_init_defines.h#L38)는 Zephyr의 `POST_KERNEL` 단계다.

여기서 kernel은 카드에서 실행되는 Zephyr 커널이다. 호스트 Linux의 드라이버 probe 이후라는 뜻이 아니다.

따라서 소스에서 확인한 것은 **BAR4 크기 설정이 카드 펌웨어의 부팅 중 PCIe 컨트롤러 초기화에 전달된다**는 사실이다. 호스트가 endpoint를 열거하기 전에 크기를 정하는 경로로 해석할 근거가 생겼다. 실제 설정을 바꿔 호스트가 어떻게 열거하는지는 아직 시험하지 않았다.

## 바꿀 수 있는 설정은 있었고, 확인 못 한 경계도 있었다

같은 태그의 [`update_bar4_size.py`](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/scripts/update_bar4_size.py#L78)는 firmware bundle의 `cmfwcfg` 안에 있는 BAR4 크기를 수정한다. 크기 0을 통한 비활성화를 지원하고, 적용하려면 cold reboot가 필요하다고 안내한다.

지난 글에서 막연히 궁금했던 “펌웨어에서 줄일 수 있나?”에 대해, 이제는 실제 설정 파일과 도구까지 찾았다.

다만 [`CntlInitV2()`의 구현은 바이너리 라이브러리와 연결되어 있다](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/CMakeLists.txt#L73). 공개 wrapper에서는 파라미터 전달을 확인할 수 있지만 실제 BAR 레지스터 쓰기와 링크 활성화의 순서를 끝까지 볼 수는 없었다.

[recovery SMC 경로](https://github.com/tenstorrent/tt-system-firmware/blob/v19.11.0/lib/tenstorrent/bh_arc/pcie.c#L469)는 정상 부팅의 펌웨어 테이블 대신 기본 크기를 사용한다. 이 소스의 BAR4 기본값은 32 GiB다. 정상 부팅 설정을 바꿨다고 recovery에서도 그대로일 것이라고 가정할 수 없었다. 이 기능이 표준 PCIe Resizable BAR capability와 같은 것인지도 확인하지 않았다.

KMD 버전도 구분해야 했다. 클라우드에서 실행 중인 모듈은 `2.9.0`이고, 지난 글에서 읽은 로컬 소스는 [`083c0399`](https://github.com/tenstorrent/tt-kmd/tree/083c0399c0e822bfe9cbf104535fcf60e2f883c3)다. 로컬 소스가 BAR4 길이에 맞춰 4 GiB window 수를 줄인다고 해서 실행 중인 모듈과 UMD 조합까지 같은 동작이라고 확인한 것은 아니다.

## 기기를 받았고, 다음 실험에 필요한 것도 보였다

처음에는 클라우드 기기를 받으면 바로 커널 실험을 할 수 있을 것 같았다.

실제로 받은 것은 호스트의 KMD를 통해 Blackhole을 사용할 수 있는 컨테이너 환경이었다. 여기서 장치 노드와 버전, BAR 할당 상태를 읽었고, 관측한 크기를 펌웨어 설정까지 연결했다.

이 환경은 스택을 이해하는 데 도움이 됐다. 반면 내가 궁금한 PCI 주소 공간 부족 문제는 발생하지 않았고, 호스트 커널 교체나 cold boot 실험을 할 접근도 아직 없었다.

다음에는 작은 PCI aperture를 가진 호스트에서 로그와 configuration space를 확인하고 싶다. BAR4 설정을 바꾼 뒤 cold boot에서 어떤 크기로 열거되는지, recovery와 reset에서는 어떻게 달라지는지, 실제 KMD·UMD·애플리케이션이 그 구성으로 동작하는지도 봐야 한다. 펌웨어 축소가 해당 카드와 소프트웨어 조합의 지원 방법인지 TT와 확인하는 일도 남아 있다.

이번 조사에서는 펌웨어 변경이나 PCI config 쓰기, 모듈 교체, 장치 리셋과 재부팅을 하지 않았다. 확인한 결과는 환경 조회와 소스 분석까지다.

관심 있다고 연락해봤는데 실제 장치에 접속할 기회가 생겼다. 열어준 접근이 고마웠다. 이제는 장비가 있다는 것뿐 아니라, 다음에 어떤 접근과 관측이 필요한지도 조금 설명할 수 있게 됐다.
