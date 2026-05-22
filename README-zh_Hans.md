[![headline](docs/assets/headline.png)](https://backstage.io/)

# [Backstage](https://backstage.io)

简体中文 \| [English](README.md) \| [한국어](README-ko_kr.md) \| [Français](README-fr_FR.md)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CNCF Status](https://img.shields.io/badge/cncf%20status-incubation-blue.svg)](https://www.cncf.io/projects)
[![Discord](https://img.shields.io/discord/687207715902193673?logo=discord&label=Discord&color=5865F2&logoColor=white)](https://discord.gg/backstage-687207715902193673)
![Code style](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)
[![Codecov](https://img.shields.io/codecov/c/github/backstage/backstage)](https://codecov.io/gh/backstage/backstage)
[![](https://img.shields.io/github/v/release/backstage/backstage)](https://github.com/backstage/backstage/releases)
[![OpenSSF Best Practices](https://bestpractices.coreinfrastructure.org/projects/7678/badge)](https://bestpractices.coreinfrastructure.org/projects/7678)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/backstage/backstage/badge)](https://securityscorecards.dev/viewer/?uri=github.com/backstage/backstage)

## Backstage 是什么？

[Backstage](https://backstage.io/) 是一个用于构建开发者门户的开放平台。在集中式软件目录的支持下，Backstage 可以恢复微服务和基础设施的秩序，并使您的产品团队能够快速交付高质量的代码，而不会影响自主权。

Backstage 统一了所有基础设施工具、服务和文档，以创建端到端的流线型开发环境。

![software-catalog](docs/assets/header.png)

开箱即用的 Backstage 包括：

- [Backstage 软件目录](https://backstage.io/docs/features/software-catalog/) 用于管理所有软件，例如微服务、类库、数据管道、网站和机器学习模型
- [Backstage 软件模板](https://backstage.io/docs/features/software-templates/) 用于快速启动新项目，并根据组织的最佳实践实现工具标准化
- [Backstage 技术文档](https://backstage.io/docs/features/techdocs/) 采用 "像编写代码一样编写文档 "的方法，轻松创建、维护、查找和使用技术文档
- 此外，[开源插件](https://github.com/backstage/backstage/tree/master/plugins) 生态系统不断发展壮大，进一步扩展了 Backstage 的可定制性和功能性

Backstage 由 Spotify 创建，但现在由 [云原生计算基金会 (CNCF)](https://www.cncf.io) 作为孵化级项目托管。更多信息请参见[公告](https://backstage.io/blog/2022/03/16/backstage-turns-two#out-of-the-sandbox-and-into-incubation)。

## 项目路线图

有关项目路线图（包括已交付的里程碑）的详细信息，请参阅[路线图](https://backstage.io/docs/overview/roadmap)。

## 开始上手

要开始使用 Backstage，请参阅[入门文档](https://backstage.io/docs/getting-started)。

## 文档

Backstage 的文档包括：

- [主要文档](https://backstage.io/docs)
- [软件目录](https://backstage.io/docs/features/software-catalog/)
- [架构](https://backstage.io/docs/overview/architecture-overview) ([决策](https://backstage.io/docs/architecture-decisions/))
- [Backstage 设计](https://backstage.io/docs/dls/design)
- [Storybook - UI 组件](https://backstage.io/storybook)

### Blitzy Sandbox 分支说明（重构已交付）

本仓库是 Backstage 的 Blitzy 定制分支，多 Checkpoint 重构已在源码层面交付。与上游 Backstage 的主要差异如下：

- **应用 Chrome**：原左侧边栏已被移除，所有页面右上角放置 Blitzy 徽标（不可点击）、设置按钮和支持按钮。支持按钮通过 `app-config.yaml` 中的 `app.support.items` 显示官方支持邮箱 `support@blitzy.com`。该集群在 `packages/app/src/modules/appModuleTopBar.tsx` 中通过 `NavContentBlueprint` 和 `app/layout` 扩展覆盖挂载（实际使用的 blueprint 选择见 `blitzy/documentation/Technical Specifications.md` _Implementation Reality Addendum_ 条目 IR-3）。
- **着陆页**：`/catalog` 是应用的着陆页；裸路径 `/` 重定向到 `/catalog`，原 Dashboard 页面已被移除。
- **权限策略**：`BlitzyPermissionPolicy` 已在 `plugins/permission-backend-module-blitzy-policy/` 中实现，并注册到 `packages/backend/src/index.ts`，替代了上游的 `AllowAllPermissionPolicy`。已验证邮箱域名为 `@blitzy.com` 的用户保留完整访问权限；其他所有已认证用户和 Guest 会话被限制为后端权限层强制执行的**只读**访问。该策略从 GitHub `signInResolver`（`packages/backend/src/authModuleGithubProvider.ts`）通过 `ctx.issueToken({ claims: { email } })` 填充的自定义 JWT `email` 声明中提取用户邮箱，并通过 `jose.decodeJwt(user.credentials.token)` 解码（实际传播路径见 Technical Specifications IR-2）。
- **审计日志**：GitHub 登录尝试和目录实体读取通过 Backstage `AuditorService` 记录（每次登录尝试发出 `user-login` 事件，每次实体读取发出 `entity-access` 事件）。`entity-access` 事件携带规范的 HTTP 请求关联 ID；`user-login` 事件携带在解析器中生成的合成 `correlationId`（UUID），这是因为 `SignInResolver` 回调不暴露 HTTP 请求。

分支专属文档（已交付）：

- [`docs/refactor/onboarding-addendum.md`](docs/refactor/onboarding-addendum.md) — 入职指南补充（清洁机器配置、LocalGCP）
- [`docs/refactor/decision-log.md`](docs/refactor/decision-log.md) — 决策日志、替代方案与风险
- [`docs/refactor/traceability-matrix.md`](docs/refactor/traceability-matrix.md) — 需求-实现双向追溯矩阵
- [`docs/refactor/architecture-before-after.md`](docs/refactor/architecture-before-after.md) — 重构前后 Mermaid 架构图
- [`docs/refactor/next-tasks.md`](docs/refactor/next-tasks.md) — 当前范围之外的后续改进项
- [`docs/observability/dashboards.md`](docs/observability/dashboards.md) — 可观测性文档与 Grafana 仪表板
- [`docs/observability/dashboard-template.json`](docs/observability/dashboard-template.json) — 可导入的 Grafana 仪表板 JSON

**关于延期项的说明**：可观测性文档中引用的自定义 Prometheus 计数器（`user_login_total`、`entity_access_total`、`blitzy_permission_decisions_total`）**已计划但尚未由源模块发出**；由 `@opentelemetry/auto-instrumentations-node` 自动检测的 HTTP/运行时指标今天即可使用。单元测试 `plugins/catalog-backend-module-access-audit/src/module.test.ts` **也尚未创建**（功能覆盖由 Playwright `auditing.test.ts` E2E 套件提供）。CI 工作流**尚未**在集成测试之前调用 `docker compose -f docker-compose.localgcp.yml up -d`，尽管 compose 文件已提交到仓库。这些项目在 `docs/refactor/next-tasks.md` 中跟踪。综合状态见 `blitzy/documentation/Project Guide.md` §0 _Verification Status (Implementation Reality)_。

## 社区

要参与我们的社区，您可以使用以下资源：

- [Discord 聊天室](https://discord.gg/backstage-687207715902193673) - 获得支持或讨论项目
- [参与贡献 Backstage](https://github.com/backstage/backstage/blob/master/CONTRIBUTING.md) - 如果您想做出贡献，请从这里开始
- [RFCs](https://github.com/backstage/backstage/labels/rfc) - 帮助制定技术方向
- [FAQ](https://backstage.io/docs/faq) - 常问问题
- [行为准则](CODE_OF_CONDUCT.md) - 这是我们的行事方式
- [采纳者](ADOPTERS.md) - 已经在使用 Backstage 的公司
- [博客](https://backstage.io/blog/) - 公告和更新
- [通讯](https://spoti.fi/backstagenewsletter) - 订阅我们的电子邮件通讯
- [Backstage 社区会议](https://github.com/backstage/community) - 参加每月聚会，探索 Backstage 社区
- 给我们点个星星吧 ⭐️ - 如果您正在使用 Backstage 或认为它是一个有趣的项目，我们希望获得你的一颗星星 ❤️

## 许可

版权所有 2020-2026 © Backstage 作者。版权所有。Linux 基金会已注册商标并使用商标。有关 Linux 基金会的商标列表，请参阅我们的商标使用页面：https://www.linuxfoundation.org/trademark-usage

采用 Apache v2.0 许可：http://www.apache.org/licenses/LICENSE-2.0

## 安全

请使用 Spotify 的 [Bug 赏金计划](https://hackerone.com/spotify) 而不是 GitHub 报告敏感安全问题。

更多详细信息，请参阅完整的[安全发布流程](SECURITY.md)。
