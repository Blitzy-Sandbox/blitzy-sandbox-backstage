[![headline](docs/assets/headline.png)](https://backstage.io/)

# [Backstage](https://backstage.io)

한국어 \| [English](README.md) \| [中文版](README-zh_Hans.md) \| [Français](README-fr_FR.md)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CNCF Status](https://img.shields.io/badge/cncf%20status-incubation-blue.svg)](https://www.cncf.io/projects)
[![Discord](https://img.shields.io/discord/687207715902193673?logo=discord&label=Discord&color=5865F2&logoColor=white)](https://discord.gg/backstage-687207715902193673)
![Code style](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)
[![Codecov](https://img.shields.io/codecov/c/github/backstage/backstage)](https://codecov.io/gh/backstage/backstage)
[![](https://img.shields.io/github/v/release/backstage/backstage)](https://github.com/backstage/backstage/releases)
[![OpenSSF Best Practices](https://bestpractices.coreinfrastructure.org/projects/7678/badge)](https://bestpractices.coreinfrastructure.org/projects/7678)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/backstage/backstage/badge)](https://securityscorecards.dev/viewer/?uri=github.com/backstage/backstage)

## 백스테이지(Backstage)란?

[백스테이지(Backstage)](https://backstage.io/) 는 개발자 포털 구출을 위한 개방형 플랫폼입니다. 중앙 집중식 소프트웨어 카탈로그를 기반으로하는 Backstage는 마이크로 서비스와 인프라의 질서를 복원하고 제품팀이 자율성을 훼손하지 않고 고품질 코드를 신속하게 출시할 수 있도록 지원합니다.

Backstage 는 모든 인프라 도구, 서비스 및 문서를 통합하여 처음부터 끝까지 간소화된 개발 환경을 만듭니다.

![software-catalog](docs/assets/header.png)

Backstage는 다음을 포함합니다:

- [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/) 마이크로 서비스, 라이브러리, 데이터 파이프라인, 웹 사이트, ML 모델 등 모든 소프트웨어 관리
- [Backstage Software Templates](https://backstage.io/docs/features/software-templates/) 새로운 프로젝트를 신속하게 시작하고 조직의 모범 사례에따라 도구를 표준화
- [Backstage TechDocs](https://backstage.io/docs/features/techdocs/) "docs like code" 접근 방식을 사용하여 기술 문서를 쉽게 작성, 유지 관리, 검색 및 사용
- [open source plugins](https://github.com/backstage/backstage/tree/master/plugins) Backstage의 사용자 정의 가능성과 기능을 확장

Backstage는 Spotify에서 제작되었지만 현재는 [Cloud Native Computing Foundation(CNCF)](https://www.cncf.io)에서 인큐베이션 수준 프로젝트로 호스팅되고 있습니다. 추가적인 정보는 [announcement](https://backstage.io/blog/2022/03/16/backstage-turns-two#out-of-the-sandbox-and-into-incubation)를 참조하세요.

## 프로젝트 로드맵

제공된 마일스톤을 포함한 자세한 프로젝트 로드맵에 대한 자세한 내용은 [the Roadmap](https://backstage.io/docs/overview/roadmap)을 참조하세요.

## 시작하기

Backstage를 시작하기위해 [Getting Started documentation](https://backstage.io/docs/getting-started)를 참조하세요.

## 문서

Backstage의 문서는 다음을 포함합니다:

- [Main documentation](https://backstage.io/docs)
- [Software Catalog](https://backstage.io/docs/features/software-catalog/)
- [Architecture](https://backstage.io/docs/overview/architecture-overview) ([Decisions](https://backstage.io/docs/architecture-decisions/))
- [Designing for Backstage](https://backstage.io/docs/dls/design)
- [Storybook - UI components](https://backstage.io/storybook)

## Blitzy Sandbox 안내 (리팩토링 진행 중)

이 저장소는 Blitzy의 Backstage 포크이며, 현재 다중 체크포인트 리팩토링이 진행 중입니다. 현재 Checkpoint 1 마일스톤은 기반 구성 산출물(`app-config.yaml`의 `app.support.items`에 추가된 `support@blitzy.com` 항목, LocalGCP compose 파일, 권한 정책 플러그인 메타데이터 스캐폴딩)만을 제공합니다. 후속 체크포인트에서 표준 Backstage와의 주요 차이점이 다음과 같이 도입될 예정입니다.

- **크롬(Chrome) UI (예정)**: 좌측 사이드바가 제거되고, 모든 페이지 상단 우측에 Blitzy 로고(클릭 불가), 설정 아이콘, 지원 버튼이 배치됩니다. 지원 버튼은 `app-config.yaml`의 `app.support.items`를 통해 공식 지원 이메일 `support@blitzy.com`을 표시합니다.
- **랜딩 페이지 (예정)**: 애플리케이션이 `/catalog`에서 시작하도록 변경되며, 루트 URL `/`는 `/catalog`로 리다이렉트됩니다. 기존 대시보드 페이지는 제거될 예정입니다.
- **권한 정책 (예정)**: 새로운 `BlitzyPermissionPolicy`가 기존 `AllowAllPermissionPolicy`를 대체할 예정입니다. 확인된 이메일 도메인이 `@blitzy.com`이 아닌 사용자와 Guest 세션은 백엔드 권한 계층에서 강제되는 **읽기 전용** 액세스로 제한됩니다. 현재 코드베이스는 여전히 업스트림의 allow-all 정책을 사용합니다.
- **감사(audit) 로그 (예정)**: GitHub 로그인(`user-login`)과 카탈로그 엔티티 액세스(`entity-access`) 이벤트가 Backstage `AuditorService`를 통해 기록될 예정입니다.

### 리팩토링 문서 (예정)

다음 산출물은 후속 체크포인트(Checkpoint 4 — _문서 및 가관측성_, Agent Action Plan §0.6.1.7 참조)에서 커밋될 예정이며, **이번 Checkpoint 1에는 포함되지 않습니다**. 향후 가시성 확보를 위해 목록만 기재합니다.

- `docs/refactor/decision-log.md` (예정) — 주요 결정 사항과 대안 및 위험 요소
- `docs/refactor/traceability-matrix.md` (예정) — 요구사항-구현 간 양방향 매핑
- `docs/refactor/architecture-before-after.md` (예정) — 크롬 및 권한 흐름 Mermaid 다이어그램
- `docs/refactor/onboarding-addendum.md` (예정) — 클린 머신 설정, LocalGCP, 사용자 정의 가이드
- `docs/refactor/next-tasks.md` (예정) — 현재 범위에서 제외된 후속 개선 사항

## 커뮤니티

커뮤니티에 참여하려면 다음 리소스를 사용하세요:

- [Discord chatroom](https://discord.gg/backstage-687207715902193673) - 지원 및 프로젝트 토론
- [Contributing to Backstage](https://github.com/backstage/backstage/blob/master/CONTRIBUTING.md) - 프로젝트 기여
- [RFCs](https://github.com/backstage/backstage/labels/rfc) - 기술 방향을 정하는 데 도움을 주세요.
- [FAQ](https://backstage.io/docs/FAQ) - 자주 묻는 질문들
- [Code of Conduct](CODE_OF_CONDUCT.md) - 커뮤니티 운영 방식
- [Adopters](ADOPTERS.md) - Backstage를 사용하고 있는 기업
- [Blog](https://backstage.io/blog/) - 공지사항 및 업데이트
- [Newsletter](https://spoti.fi/backstagenewsletter) - 이메일 뉴스레터 구독
- [Backstage Community Sessions](https://github.com/backstage/community) - 월간 모임 참여 및 커뮤니티 톺아보기
- Backstage를 사용중이거나 흥미로운 프로젝트라고 생각하신다면 별표를 눌러주세요. 별표는 사랑입니다 ❤️

## License

Copyright 2020-2026 © The Backstage Authors. All rights reserved. The Linux Foundation has registered trademarks and uses trademarks. For a list of trademarks of The Linux Foundation, please see our Trademark Usage page: https://www.linuxfoundation.org/trademark-usage

Licensed under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0

## 보안

민감한 보안문제는 Github가 아닌 Spotify의 [bug-bounty program](https://hackerone.com/spotify) 통해 신고해주세요
Please report sensitive security issues using Spotify's [bug-bounty program](https://hackerone.com/spotify) rather than GitHub.

자세한 내용은 [security release process](SECURITY.md)를 참고하세요.
