---
title: '커널 실험일지 4 — Rust에서 권장하는 거면, 커널에도 적용해볼까'
description: 'Rust Clippy의 borrow_as_ptr 권장 사항을 찾아 커널에 적용했다. 중간 참조를 raw borrow로 바꾸고, 같은 패턴을 확인할 lint를 활성화하기까지.'
lang: ko
translationKey: rust-borrow-as-ptr
publishedAt: 2026-09-26
tags: [Linux, Kernel, Rust, Clippy, FFI, Upstream]
---

지난번에는 커널 하나 부팅시키는 데 하루를 썼다.

이번에는 코드다. 드디어.

이번 작업의 출발점은 Rust Clippy 문서에서 찾은 [`borrow_as_ptr`](https://rust-lang.github.io/rust-clippy/master/index.html#borrow_as_ptr)라는 lint였다.

참조를 만든 다음 바로 raw pointer로 바꾸는 코드에는 `&raw const`나 `&raw mut`를 쓰라는 권장 사항이다.

이걸 보고 커널의 Rust 코드에도 적용해보기로 했다.

## 권장하는 이유부터 봤다

문서에서 설명하는 변경은 이런 형태다.

```rust
let mut value = 0;
let ptr = &mut value as *mut i32;
```

이걸 다음처럼 쓴다.

```rust
let mut value = 0;
let ptr = &raw mut value;
```

최종적으로 필요한 것은 포인터인데, 앞의 코드는 중간에 `&mut` 참조를 만든다. 뒤의 코드는 그 참조를 만들지 않고 바로 raw pointer를 얻는다.

Clippy가 제시하는 이유는 가독성과 불필요한 참조 생성이다. 특히 초기화되지 않은 값이나 정렬이 맞지 않는 위치에서는 참조를 만드는 것 자체가 문제가 될 수 있다.

아, 단순히 표현을 짧게 바꾸라는 이야기는 아니구나.

Rust 참조에는 정렬, 값의 유효성, aliasing 같은 조건이 붙는다. 잠깐 만들었다가 포인터로 변환한다고 해서 그 조건을 건너뛸 수는 없다. 이 부분은 [Rust Reference의 raw borrow 설명](https://doc.rust-lang.org/reference/expressions/operator-expr.html#raw-borrow-operators)으로 이어진다.

그렇다고 `&raw`를 붙이면 그 포인터로 무엇을 해도 괜찮다는 뜻은 아니다. 이후의 읽기와 쓰기, 수명, C 함수가 요구하는 조건은 여전히 확인해야 한다.

## 커널에도 같은 형태가 있었다

커널의 Rust 코드는 C 함수를 호출하는 일이 많다. C 함수에 결과를 써줄 변수의 주소를 넘기는 경우도 있고, 구조체 필드의 포인터를 전달하는 경우도 있다.

꼭 `as *mut T`가 적혀 있어야 하는 것은 아니다. 함수 인자가 raw pointer를 요구하면, 넘긴 참조가 그 자리에서 변환될 수도 있다.

이번 변경에 들어간 DMA 코드가 그런 예다.

`dma_alloc_attrs()`에 전달하는 인자 중 하나를 이렇게 바꿨다.

```diff
- &mut dma_addr,
+ &raw mut dma_addr,
```

DMA 주소를 돌려받을 변수의 포인터가 필요한 자리다.

그 외에도 CPU mask 할당, 장치 속성, 보안 정보, RBTree, XArray 등 여러 코드에 같은 형태가 있었다. [첫 번째 커밋](https://github.com/asdfkwang/linux/commit/461027954f2a1d0f7a020b35fb983a77e09e3536)에 그 변경들을 모았다.

diff를 보면 대부분 한 줄씩이다.

분명 작은 변경인데 파일은 여기저기 걸쳐 있다. Rust와 C가 만나는 자리가 그만큼 많다는 게 보인다.

## 그렇다고 전부 버그였다는 이야기는 아니다

여기는 구분해서 적어두고 싶다.

기존 코드가 참조를 만들기에 유효한 대상을 다루고 있었다면, 그 표현을 썼다는 이유만으로 버그가 되는 것은 아니다.

이번 작업은 Clippy가 권장하는 형태로 코드를 정리하는 변경이다. 커밋에도 기능 변경을 의도하지 않는다고 적었다.

“메모리 버그를 잔뜩 고쳤다”라고 쓰면 이야기가 이상해진다.

raw pointer가 필요한 자리에서 중간 참조를 만드는 표현을 걷어내고, 코드에도 그 의도가 직접 드러나도록 바꾼 것이다.

`unsafe`가 없어지는 것도 아니다. 기존에 설명하던 안전성 조건은 여전히 필요하다.

## 커널에서 쓸 수 있는 문법인가?

권장 사항을 찾았다고 바로 적용할 수 있는 것은 아니다.

커널이 지원하는 Rust 버전에서도 사용할 수 있어야 한다.

이번 패치의 커밋 메시지에는 `&raw` 문법이 Rust 1.82부터 안정화됐고, 작업 기준 커널의 최소 Rust 버전은 1.85라는 점을 함께 적었다. 이 기준에서는 새 문법 때문에 별도 버전 분기를 둘 필요가 없었다.

바꾼 줄은 짧아도, 왜 바꿔도 되는지는 설명해야 했다.

## 두 번째 커밋은 한 줄

기존 사용처를 정리한 다음에는 공통 Rust 빌드 플래그에 lint를 추가했다.

```makefile
-Wclippy::borrow_as_ptr
```

[두 번째 커밋](https://github.com/asdfkwang/linux/commit/b59da38005e9460b51b23d04d28401971906d402)은 이 한 줄이다.

앞으로 Clippy 검사를 할 때 같은 패턴을 다시 알려주도록 하는 변경이다.

그래서 순서는 기존 코드 정리가 먼저, lint 활성화가 그다음이다. 지금 있는 코드를 고치는 것과 이후에도 확인할 수 있게 만드는 것을 두 커밋으로 나눴다.

## 이번에는 문서에서 패치로

이번 작업은 Rust 쪽에서 권장하는 내용을 찾아 커널 코드에 적용해본 기록이다.

문서에는 작은 예제가 나온다. 커널에서는 그 형태가 DMA에도 있고, 자료구조에도 있고, C 함수에 결과를 돌려받는 인자에도 있었다.

문서의 예제를 읽는 것과 실제 사용처를 찾아 변경하는 것은 또 달랐다. 왜 권장하는지, 커널의 지원 버전에서 쓸 수 있는지, 변경 의도를 어떻게 설명할지까지 따라가야 했다.

지난번에는 부팅 환경을 만들다가 하루가 갔는데, 이번에 남은 것은 여러 군데의 `&raw`와 Makefile 한 줄이다.

그래도 드디어 블로그에 커널 설정 말고 패치 이야기를 적었다.

작업은 [`rust-borrow-as-ptr-v1` 브랜치](https://github.com/asdfkwang/linux/tree/rust-borrow-as-ptr-v1)에 정리해뒀다.
