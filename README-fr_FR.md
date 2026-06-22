[![headline](docs/assets/headline.png)](https://backstage.io/)

# [Backstage](https://backstage.io)

Français \| [English](README.md) \| [한국어](README-ko_kr.md) \| [中文版](README-zh_Hans.md)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CNCF Status](https://img.shields.io/badge/cncf%20status-incubation-blue.svg)](https://www.cncf.io/projects)
[![Discord](https://img.shields.io/discord/687207715902193673?logo=discord&label=Discord&color=5865F2&logoColor=white)](https://discord.gg/backstage-687207715902193673)
![Code style](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)
[![Codecov](https://img.shields.io/codecov/c/github/backstage/backstage)](https://codecov.io/gh/backstage/backstage)
[![](https://img.shields.io/github/v/release/backstage/backstage)](https://github.com/backstage/backstage/releases)
[![OpenSSF Best Practices](https://bestpractices.coreinfrastructure.org/projects/7678/badge)](https://bestpractices.coreinfrastructure.org/projects/7678)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/backstage/backstage/badge)](https://securityscorecards.dev/viewer/?uri=github.com/backstage/backstage)

## Qu'est-ce que Backstage?

[Backstage](https://backstage.io/) est un framework open source conçu pour créer des portails à destination des développeurs. Avec l'idée de fournir un catalogue d'applications centralisé, Backstage remet de l'ordre dans vos microservices et votre infrastructure, ce qui permet à vos équipes produit de coder rapidement et de manière efficace sans perdre en autonomie.

Backstage rassemble tous vos outils d'infrastructure, services et documentations pour créer un environnement de développement fluide de bout en bout.

![software-catalog](docs/assets/header.png)

Out-of-the-box, Backstage comprend :

- [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/) pour gérer tous vos logiciels tels que les microservices, les bibliothèques, les pipelines de données, les sites web et les modèles ML.
- [Backstage Software Templates](https://backstage.io/docs/features/software-templates/) pour créer rapidement de nouveaux projets et uniformiser vos outils selon les meilleures pratiques de votre organisation.
- [Backstage TechDocs](https://backstage.io/docs/features/techdocs/) pour faciliter la création, la maintenance, la recherche et l'utilisation de la documentation technique, en adoptant une approche "docs like code".
- De plus, un écosystème croissant de [plugins open source](https://github.com/backstage/backstage/tree/master/plugins) qui étendent davantage la personnalisation et les fonctionnalités de Backstage.

Backstage a été initialement développé par Spotify, mais il est désormais hébergé par la [Cloud Native Computing Foundation (CNCF)](https://www.cncf.io) en tant que projet en stade d'incubation. Pour en savoir plus, consultez l'[annonce](https://backstage.io/blog/2022/03/16/backstage-turns-two#out-of-the-sandbox-and-into-incubation).

## Roadmap du projet

Pour des informations sur la roadmap détaillée du projet, y compris les jalons atteints, consultez [la Roadmap](https://backstage.io/docs/overview/roadmap).

## Démarrage

Pour commencer à utiliser Backstage, consultez [Getting Started documentation](https://backstage.io/docs/getting-started).

## Documentation

La documentation de Backstage inclut:

- [Main documentation](https://backstage.io/docs)
- [Software Catalog](https://backstage.io/docs/features/software-catalog/)
- [Architecture](https://backstage.io/docs/overview/architecture-overview) ([Decisions](https://backstage.io/docs/architecture-decisions/))
- [Designing for Backstage](https://backstage.io/docs/dls/design)
- [Storybook - UI components](https://backstage.io/storybook)

### Spécificités Blitzy Sandbox (refactor livré)

Ce dépôt est le fork Blitzy de Backstage. Le refactor multi-checkpoints est livré côté code source. Les principales différences avec le Backstage d'origine sont :

- **Chrome de l'application** : la barre latérale d'origine a été remplacée par une **barre supérieure** en haut à droite, contenant un logo Blitzy non cliquable, un bouton Réglages liant `/settings`, et un bouton Support affichant `support@blitzy.com`. Le cluster est monté dans `packages/app/src/modules/appModuleTopBar.tsx` via `NavContentBlueprint` et un override de l'extension `app/layout` (voir `blitzy/documentation/Technical Specifications.md` _Implementation Reality Addendum_, entrée IR-3, pour le choix de blueprint réellement utilisé).
- **Page d'accueil** : `/catalog` est la page d'accueil de l'application ; `/` redirige vers `/catalog` et l'ancien Dashboard a été supprimé.
- **Politique d'autorisation** : `BlitzyPermissionPolicy` est implémentée dans `plugins/permission-backend-module-blitzy-policy/` et enregistrée dans `packages/backend/src/index.ts`, remplaçant la politique `AllowAllPermissionPolicy` d'amont. Les utilisateurs dont le domaine d'e-mail vérifié est `@blitzy.com` conservent l'accès complet ; tous les autres utilisateurs authentifiés et les sessions Guest sont contraints à un accès **en lecture seule**, appliqué par la couche d'autorisation du backend. La politique lit l'e-mail depuis la _claim_ JWT personnalisée `email` que le `signInResolver` GitHub (`packages/backend/src/authModuleGithubProvider.ts`) émet via `ctx.issueToken({ claims: { email } })` et que la politique décode avec `jose.decodeJwt(user.credentials.token)` — voir IR-2 dans Technical Specifications pour le chemin de propagation tel qu'implémenté.
- **Audit** : les connexions GitHub et les lectures d'entités du catalogue sont enregistrées via `AuditorService` (`user-login` à chaque tentative de connexion, `entity-access` à chaque lecture d'entité). Les événements `entity-access` portent l'identifiant de corrélation HTTP canonique ; les événements `user-login` portent un `correlationId` synthétique (UUID) généré dans le résolveur, car le rappel `SignInResolver` n'expose pas la requête HTTP.

Documentation spécifique au fork (livrée) :

- [`docs/refactor/onboarding-addendum.md`](docs/refactor/onboarding-addendum.md) — addendum d'intégration (machine neuve, LocalGCP)
- [`docs/refactor/decision-log.md`](docs/refactor/decision-log.md) — journal des décisions, alternatives et risques
- [`docs/refactor/traceability-matrix.md`](docs/refactor/traceability-matrix.md) — matrice de traçabilité bidirectionnelle
- [`docs/refactor/architecture-before-after.md`](docs/refactor/architecture-before-after.md) — diagrammes Mermaid avant/après
- [`docs/refactor/next-tasks.md`](docs/refactor/next-tasks.md) — prochaines tâches hors périmètre actuel
- [`docs/observability/dashboards.md`](docs/observability/dashboards.md) — observabilité, dashboards Grafana
- [`docs/observability/dashboard-template.json`](docs/observability/dashboard-template.json) — modèle de dashboard Grafana importable

**Statut d'observabilité** : les compteurs Prometheus personnalisés (`user_login_total`, `entity_access_total`, `blitzy_permission_decisions_total`) référencés dans la documentation d'observabilité sont **implémentés et émis** par les modules sources (`packages/backend/src/metrics.ts`, `plugins/catalog-backend-module-access-audit/src/metrics.ts`, `plugins/permission-backend-module-blitzy-policy/src/metrics.ts`) via l'API métriques unifiée `@opentelemetry/api` ; les métriques HTTP/runtime auto-instrumentées par `@opentelemetry/auto-instrumentations-node` sont disponibles aux côtés des compteurs personnalisés. Le test unitaire `plugins/catalog-backend-module-access-audit/src/module.test.ts` est **créé avec 25 cas exécutés** qui passent, en complément de la suite Playwright `auditing.test.ts`. Le workflow CI **n'invoque pas encore** `docker compose -f docker-compose.localgcp.yml up -d` avant les tests d'intégration, bien que le fichier compose soit présent dans le dépôt — cet élément restant est suivi dans `docs/refactor/next-tasks.md` entrée 7. Le statut consolidé est disponible dans `blitzy/documentation/Project Guide.md` §0 _Verification Status (Implementation Reality)_.

## Communauté

Si vous voulez contribuer et vous impliquer dans notre communauté, voici les ressources à votre disposition :

- [Discord chatroom](https://discord.gg/backstage-687207715902193673) - Pour obtenir de l'aide ou discuter du projet
- [Contributing to Backstage](https://github.com/backstage/backstage/blob/master/CONTRIBUTING.md) - Rendez-vous ici si vous souhaitez contribuer
- [RFCs](https://github.com/backstage/backstage/labels/rfc) - Contribuez à définir la direction technique
- [FAQ](https://backstage.io/docs/faq)
- [Code of Conduct](CODE_OF_CONDUCT.md) - C'est comme ça qu'on fonctionne
- [Adopters](ADOPTERS.md) - Les entreprises utilisant déjà Backstage
- [Blog](https://backstage.io/blog/) - Annonces et mises à jour
- [Newsletter](https://spoti.fi/backstagenewsletter) - Abonnez-vous à notre newsletter par mail
- [Backstage Community Sessions](https://github.com/backstage/community) - Participez aux rencontres mensuelles et découvrez la communauté Backstage
- Donnez-nous une étoile ⭐️ - Si vous utilisez Backstage ou si vous trouvez que c'est un projet intéressant, nous apprécierions beaucoup votre soutien ❤️

## Licence

Copyright 2020-2026 © Les auteurs de Backstage. Tous droits réservés. La Linux Foundation détient des marques déposées et utilise des marques commerciales. Pour une liste des marques de commerce de la Linux Foundation, veuillez consulter notre page d'utilisation des marques: https://www.linuxfoundation.org/trademark-usage

Sous licence Apache, version 2.0: http://www.apache.org/licenses/LICENSE-2.0

## Sécurité

Veuillez signaler les problèmes de sécurité sensibles en utilisant le [programme de bug-bounty](https://hackerone.com/spotify) de Spotify plutôt que GitHub.

Pour plus de détails, consultez notre processus complet de [publication de sécurité](SECURITY.md).
