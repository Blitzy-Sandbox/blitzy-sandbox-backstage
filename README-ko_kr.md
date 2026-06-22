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

## Blitzy Sandbox 안내 (리팩토링 완료)

이 저장소는 Blitzy의 Backstage 포크이며, 다중 체크포인트 리팩토링이 소스 코드 측면에서 완료되었습니다. 표준 Backstage와의 주요 차이점은 다음과 같습니다.

- **크롬(Chrome) UI**: 좌측 사이드바가 제거되었고, 모든 페이지 상단 우측에 Blitzy 로고(클릭 불가), 설정 아이콘, 지원 버튼이 배치됩니다. 지원 버튼은 `app-config.yaml`의 `app.support.items`를 통해 공식 지원 이메일 `support@blitzy.com`을 표시합니다. 이 클러스터는 `packages/app/src/modules/appModuleTopBar.tsx`에 `NavContentBlueprint`와 `app/layout` 익스텐션 오버라이드를 통해 마운트됩니다(실제로 사용된 블루프린트 선택은 `blitzy/documentation/Technical Specifications.md` _Implementation Reality Addendum_ IR-3 참조).
- **랜딩 페이지**: `/catalog`가 애플리케이션 랜딩 페이지이며, 루트 URL `/`는 `/catalog`로 리다이렉트됩니다. 기존 대시보드 페이지는 제거되었습니다.
- **권한 정책**: `BlitzyPermissionPolicy`가 `plugins/permission-backend-module-blitzy-policy/`에 구현되어 `packages/backend/src/index.ts`에 등록되어 있으며, 업스트림의 `AllowAllPermissionPolicy`를 대체합니다. 확인된 이메일 도메인이 `@blitzy.com`인 사용자는 전체 액세스 권한을 유지하며, 그 외 모든 인증된 사용자와 Guest 세션은 백엔드 권한 계층에서 강제되는 **읽기 전용** 액세스로 제한됩니다. 이 정책은 GitHub `signInResolver`(`packages/backend/src/authModuleGithubProvider.ts`)가 `ctx.issueToken({ claims: { email } })`로 발급한 커스텀 JWT `email` 클레임에서 이메일을 추출하며, `jose.decodeJwt(user.credentials.token)`로 디코딩합니다(실제 전파 경로는 Technical Specifications IR-2 참조).
- **감사(audit) 로그**: GitHub 로그인 시도와 카탈로그 엔티티 읽기가 Backstage `AuditorService`를 통해 기록됩니다(`user-login`은 모든 로그인 시도에 대해, `entity-access`는 모든 엔티티 읽기에 대해 발행됩니다). `entity-access` 이벤트는 HTTP 요청의 정식 상관관계 ID를 포함하며, `user-login` 이벤트는 `SignInResolver` 콜백이 HTTP 요청을 노출하지 않기 때문에 리졸버에서 생성한 합성 `correlationId`(UUID)를 포함합니다.

### 리팩토링 문서 (제공됨)

다음 산출물이 리포지토리에 포함되어 있습니다:

- [`docs/refactor/decision-log.md`](docs/refactor/decision-log.md) — 주요 결정 사항, 대안, 위험 요소
- [`docs/refactor/traceability-matrix.md`](docs/refactor/traceability-matrix.md) — 요구사항-구현 양방향 매핑
- [`docs/refactor/architecture-before-after.md`](docs/refactor/architecture-before-after.md) — 크롬 및 권한 흐름 Mermaid 다이어그램
- [`docs/refactor/onboarding-addendum.md`](docs/refactor/onboarding-addendum.md) — 클린 머신 설정, LocalGCP 설정, 커스터마이즈 가이드
- [`docs/refactor/next-tasks.md`](docs/refactor/next-tasks.md) — 현재 범위에서 제외된 후속 개선 사항
- [`docs/observability/dashboards.md`](docs/observability/dashboards.md) — 가관측성 문서, Grafana 대시보드
- [`docs/observability/dashboard-template.json`](docs/observability/dashboard-template.json) — 가져올 수 있는 Grafana 대시보드 JSON

**가관측성 상태**: 가관측성 문서에서 참조된 커스텀 Prometheus 카운터(`user_login_total`, `entity_access_total`, `blitzy_permission_decisions_total`)는 통합 메트릭 API `@opentelemetry/api`를 통해 소스 모듈(`packages/backend/src/metrics.ts`, `plugins/catalog-backend-module-access-audit/src/metrics.ts`, `plugins/permission-backend-module-blitzy-policy/src/metrics.ts`)에서 **구현되어 방출되고 있습니다**. `@opentelemetry/auto-instrumentations-node`로 자동 계측된 HTTP/런타임 메트릭은 커스텀 카운터와 함께 사용 가능합니다. 단위 테스트 `plugins/catalog-backend-module-access-audit/src/module.test.ts`는 **25개의 실행 케이스가 통과하도록 생성되었습니다**(Playwright `auditing.test.ts` E2E 스위트의 보완). CI 워크플로는 통합 테스트 전에 `docker compose -f docker-compose.localgcp.yml up -d`를 **아직 호출하지 않습니다**(compose 파일은 리포지토리에 커밋되어 있음) — 이 남은 항목은 `docs/refactor/next-tasks.md` 항목 7에서 추적됩니다. 통합된 상태는 `blitzy/documentation/Project Guide.md` §0 _Verification Status (Implementation Reality)_ 참조.

## 커뮤니티

커뮤니티에 참여하려면 다음 리소스를 사용하세요:

- [Discord chatroom](https://discord.gg/backstage-687207715902193673) - 지원 및 프로젝트 토론
- [Contributing to Backstage](https://github.com/backstage/backstage/blob/master/CONTRIBUTING.md) - 프로젝트 기여
- [RFCs](https://github.com/backstage/backstage/labels/rfc) - 기술 방향을 정하는 데 도움을 주세요.
- [FAQ](https://backstage.io/docs/faq) - 자주 묻는 질문들
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
