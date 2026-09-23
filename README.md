# Anyway

> AI can do it. I want to understand it anyway.
>
> AI가 할 수 있어도, 나는 어쨌든 직접 이해하고 싶다.

Astro 기반 한국어/영어 기술 블로그. Markdown·MDX, Shiki 코드 하이라이팅, 정적 GitHub Pages 배포를 지원합니다.

## 로컬 실행

Node.js 24 LTS 권장 (`.nvmrc` 제공), npm 사용.

```sh
npm ci
npm run dev
```

브라우저에서 `http://localhost:4321/anyway/`를 엽니다. 저장소 이름 때문에 로컬에서도 `/anyway/` 경로를 사용합니다.

```sh
npm test        # 언어 선택 로직 검증
npm run check  # Astro / TypeScript 검사
npm run build  # 검사 후 dist/에 정적 사이트 생성
npm run preview # 빌드 결과 미리보기
```

## 언어와 번역

- `/anyway/` 진입 시 저장된 수동 선택을 먼저 적용합니다. 선택이 없으면 브라우저의 언어 우선순위 중 `ko` 또는 `en`을 선택하며, 둘 다 없으면 영어로 이동합니다.
- 언어 전환 링크는 `localStorage`의 `anyway.language`에 선택을 저장합니다. 저장소 접근이 차단되어도 이동은 동작합니다.
- `/anyway/ko/` 또는 `/anyway/en/` 및 글 직접 링크는 자동 전환하지 않습니다.
- JavaScript를 끈 경우 첫 화면의 한국어/English 링크로 들어갈 수 있습니다.
- 글에서 언어를 바꾸면 동일한 `translationKey`를 가진 번역으로 이동합니다. 번역이 없거나 초안이면 해당 언어의 목록으로 이동하고 번역 준비 상태를 표시합니다.

## 글 작성

`src/content/posts/ko/`와 `src/content/posts/en/`에 `.md` 또는 `.mdx` 파일을 추가하세요. 예제 글은 삭제하거나 수정해도 됩니다.

```yaml
---
title: 'UART를 따라가 보기'
description: '드라이버의 진입점부터 데이터 전송까지.'
lang: ko
translationKey: tracing-uart
publishedAt: 2026-09-22
tags: [Linux, UART]
draft: false
---
```

영어 글은 `en/` 폴더에 만들고 `lang: en`과 **동일한 `translationKey`**를 사용합니다. 파일 이름은 달라도 됩니다. URL은 `/anyway/ko/posts/tracing-uart/`가 됩니다. `translationKey`에는 영문 소문자·숫자·하이픈을 사용하세요. 언어별 중복 키와 폴더/언어 불일치는 빌드 오류로 검출됩니다.

`draft: true`는 목록과 페이지 생성에서 제외됩니다. 날짜는 표시와 정렬에 사용하며 미래 날짜라도 자동으로 예약 발행하지 않습니다.

코드 블록에 언어를 붙이면 Shiki가 강조합니다. 예: 세 개의 백틱 뒤에 `c`, `bash`, `python`.

MDX에서는 Astro 컴포넌트를 import할 수 있습니다. Canvas, SVG, 브라우저 스크립트 등을 넣어 그래픽이나 인터랙티브 설명을 자유롭게 만들 수 있습니다. React 등 프레임워크를 사용하려면 해당 Astro 통합을 별도로 설치하세요.

## 디자인 변경

- `src/styles/global.css`: 색상, 폰트, 레이아웃, 글 스타일, 모바일 대응
- `src/layouts/Base.astro`: 공통 헤더·언어 전환·메타 정보·푸터
- `src/pages/[lang]/index.astro`: 언어별 홈 화면
- `src/pages/[lang]/posts/[slug].astro`: 글 화면
- `src/components/`: 재사용할 그래픽·인터랙티브 컴포넌트

폰트는 Google Fonts에서 불러오며, 접근할 수 없으면 시스템 폰트로 표시합니다.

## GitHub Pages 배포

현재 원격 저장소 `asdfkwang/anyway`를 기준으로 설정되어 있습니다.

1. GitHub 저장소 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다.
2. 변경 사항을 직접 커밋하고 `main`에 push합니다.
3. Actions에서 **Build and deploy Anyway**가 성공하면 `https://asdfkwang.github.io/anyway/`에서 확인합니다.

`main` push 및 수동 실행은 검사·빌드 후 배포합니다. Pull request는 검사·빌드만 수행합니다. 의존성은 `package-lock.json`과 `npm ci`로 재현합니다. GitHub Pages 사용이 가능한 저장소 설정/계정이 필요합니다.

저장소나 도메인을 바꾸면 `astro.config.mjs`의 `site`와 `base`를 수정하세요. 사용자 루트 저장소 또는 커스텀 도메인에서는 일반적으로 `base: '/'`를 사용합니다. 내부 링크는 공통 경로 함수로 이 설정을 따릅니다.

공식 문서: https://docs.astro.build/en/guides/deploy/github/

## giscus 연결 지점

현재 외부 댓글 스크립트는 로드하지 않습니다. `src/components/Comments.astro`가 각 글에 배치되어 있고 `translationKey`와 `lang`을 전달받습니다.

나중에 https://giscus.app 에서 저장소 Discussions와 giscus 앱을 설정한 후, 생성한 스크립트를 이 컴포넌트에 추가하세요. `data-mapping="specific"`, `data-term={translationKey}`를 사용하면 한영 글이 같은 토론을 공유합니다. `data-lang`은 현재 언어로 지정하세요. 별도의 토론을 원하면 term에 언어를 포함하세요. 저장소 ID와 카테고리 ID는 giscus에서 받은 실제 값을 사용해야 합니다.

## 사람용 한·영 + AI용 발행

글의 한·영 파일에 같은 `translationKey`를 지정하면 빌드 시 세 가지 읽기 경로를 함께 만듭니다.

- 한국어 HTML: `/anyway/ko/posts/<translationKey>/`
- 영어 HTML: `/anyway/en/posts/<translationKey>/`
- AI용 Markdown: `/anyway/ai/<translationKey>.md` — 영어 핵심 요약과 태그, 날짜, 한·영 원문 URL을 한 문서에 포함

AI 문서를 따로 작성할 필요는 없습니다. **번역 자체는 자동 생성하지 않습니다.** 한·영 원고를 작성하면 함께 발행되며, 한 언어만 작성했다면 해당 언어만 발행됩니다. 초안은 AI 문서·검색 인덱스·태그·사이트맵에서도 제외됩니다.

AI 문서는 영문 글 frontmatter의 `aiSummary: |`에 작성한 핵심 요약을 사용합니다. 목표·확인된 관찰·선택한 구성·아직 검증하지 않은 작업을 구분해서 적으세요. 생략하면 영문 `description`을 사용하며, 전체 본문은 AI 문서에 복제하지 않습니다. 한·영 원문을 수정할 때 영어 요약도 함께 갱신하세요. 공개된 영문 글이 없으면 해당 AI 문서와 링크는 생성하지 않습니다. `llms.txt`의 제목과 설명도 영어로 제공합니다.

검색 인덱스의 본문은 Markdown/MDX의 렌더링된 본문에서 추출합니다. 코드 블록, 링크, 표, 이미지의 대체 텍스트를 보존하며 링크는 절대 URL로 변환합니다. MDX import문이나 실행 스크립트는 내보내지 않습니다. Canvas·3D·클라이언트 전용 컴포넌트는 그림 자체를 텍스트로 변환할 수 없으므로 **같은 본문에 설명, 주요 수치, 결론을 텍스트로 적어 주세요.** React 등 새로운 통합을 추가할 때는 `src/lib/discovery.ts`의 Astro container 렌더러 설정도 검토해야 합니다.

## 태그와 검색

카테고리 계층 없이 `tags`를 사용합니다. 예: `[Linux, UART, ARM64]`. 한·영 글에 같은 기술 태그를 쓰면 연결이 일관됩니다. 태그는 Unicode NFKC 정규화, 소문자, 앞뒤 공백 제거를 적용합니다. 한국어, `C++`, `C#` 등도 지원하며 일반 영문 태그는 `/tags/linux/`처럼 읽을 수 있는 URL을 쓰며, 한국어·기호를 포함한 태그는 충돌 없는 코드포인트 식별자로 생성됩니다.

- 헤더의 **검색**: 한·영 제목, 요약, 태그, 본문을 함께 검색합니다.
- 여러 검색어: 모두 포함된 글을 검색합니다. 예: `uart interrupt`.
- `#linux`: 해당 태그와 정확히 일치하는 글을 찾습니다.
- 태그 > 제목 > 요약 > 본문 순서로 결과에 가중치를 줍니다.
- 글과 홈의 태그 링크: JavaScript 없이도 읽을 수 있는 정적 태그 목록 페이지입니다.
- 검색은 전체 JSON을 브라우저로 가져오는 단순한 문자열 검색입니다. 의미 기반 검색이나 외부 검색 서비스는 사용하지 않습니다. 글이 매우 많아지면 검색 인덱스 분할을 고려하세요.

## 검색 엔진과 AI 수집 경로

- `/anyway/sitemap.xml`: 언어별 글과 태그 페이지를 포함한 사이트맵
- `/anyway/search-index.json`: 공개 글 전체의 메타데이터와 본문, HTML·Markdown URL
- `/anyway/llms.txt`: AI 문서와 인덱스를 연결한 보조 목록
- 글 HTML: canonical, hreflang, BlogPosting JSON-LD, Markdown 대체 링크

`llms.txt`는 보조 탐색 경로이며 검색 노출을 보장하거나 크롤러 권한을 제어하는 표준이 아닙니다. 방문자와 봇에게 동일한 원문을 제공합니다. 원문 제목·요약·근거 링크·코드·태그를 정확하게 작성하는 것이 중요합니다.

GitHub Pages 프로젝트 사이트의 `/anyway/robots.txt`는 도메인 루트 `/robots.txt`를 대체할 수 없으므로 잘못된 접근 제어 파일을 만들지 않았습니다. 루트 `robots.txt`나 루트 `llms.txt`가 필요하다면 `asdfkwang.github.io` 저장소/커스텀 도메인에서 관리해야 합니다. 배포 후 Google Search Console 등에서 실제 사이트맵 URL `https://asdfkwang.github.io/anyway/sitemap.xml`을 제출할 수 있습니다. 이번 작업은 외부 검색 엔진 등록이나 실제 배포를 수행하지 않습니다.
