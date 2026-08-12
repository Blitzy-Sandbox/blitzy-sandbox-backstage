#!/usr/bin/env python3
"""
Generates catalog-blitzy-public-samples.yaml — one static Backstage catalog
file containing every repo in the `blitzy-public-samples` GitHub org as a
Component, grouped under a single System.

Unlike create_catalog_entries.py, this script writes NOTHING to GitHub. It
produces a single file in this repo, which is ingested via a static file
location in app-config.yaml. This avoids needing push access to the org.

Usage:
    GITHUB_TOKEN=<token> python3 scripts/generate_public_samples_catalog.py
    GITHUB_TOKEN=<token> python3 scripts/generate_public_samples_catalog.py --dry-run
"""

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml not installed. Run: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

ORG = "blitzy-public-samples"
SYSTEM = "blitzy-public-samples"
GROUP = "blitzy-samples"
OUTPUT_FILE = "catalog-blitzy-public-samples.yaml"
VERTICALS_FILE = os.path.join(os.path.dirname(__file__), "blitzy-verticals.json")

GITHUB_LANG_TO_TAG: dict[str, str] = {
    "TypeScript": "typescript",
    "JavaScript": "javascript",
    "Python":     "python",
    "Go":         "go",
    "Java":       "java",
    "Rust":       "rust",
    "C":          "c",
    "C++":        "cpp",
    "C#":         "csharp",
    "PHP":        "php",
    "Ruby":       "ruby",
    "Kotlin":     "kotlin",
    "Swift":      "swift",
    "Shell":      "shell",
    "Solidity":   "solidity",
    "HTML":       "html",
    "CSS":        "css",
}

ENTITY_NAME_RE = re.compile(r"[^a-zA-Z0-9_.\-]")


def _rx(*terms):
    parts = []
    for t in terms:
        t = t.strip()
        if re.match(r"^[a-z0-9]+$", t):
            parts.append(rf"\b{re.escape(t)}\b")
        else:
            parts.append(re.escape(t))
    return re.compile("|".join(parts), re.IGNORECASE)


# (regex, tags) — matched against name + description + PR title + guide title.
# The Blitzy use case ("what Blitzy did") comes from PR title / guide title;
# the tech stack from any of the four; name-based patterns cover repos with no
# PR/guide data (Platform runs that never produced a branch).
TAG_RULES: list[tuple[re.Pattern[str], list[str]]] = [
    (_rx("migration", "→", "monolith-to-microservices"),                       ["migration"]),
    (_rx("refactor", "refactoring", "decomposition", "restructur",
         "restoration", "consolidation"),                                       ["refactor"]),
    (_rx("documentation", "inline doc", "retrofit"),                           ["documentation"]),
    (_rx("security", "vulnerabilit", "ghsa", "owasp", "injection",
         "authentication bypass", "sec-01"),                                    ["security"]),
    (_rx("audit", "conformance", "code quality"),                              ["audit"]),
    (_rx("test suite", "test coverage", "mutation testing", "in-repo test"),   ["test-suite"]),
    (_rx("bug fix", "bug-fix", "remediation", "overflow fix", "patch"),        ["bug-fix"]),
    (_rx("modernization", "modernize"),                                        ["modernization"]),
    (_rx("tutorial", "hello world", "reveal.js"),                              ["tutorial"]),
    (_rx("rewrite", "from scratch"),                                           ["rewrite"]),
    (_rx("reverse-engineering", "reverse engineering"),                        ["reverse-engineering"]),
    (_rx("add feature", "new feature", "enhancement"),                         ["new-feature"]),
    (_rx("grafana"),         ["grafana"]),
    (_rx("terraform"),       ["terraform"]),
    (_rx("kafka"),           ["kafka"]),
    (_rx("spark"),           ["spark"]),
    (_rx("hadoop"),          ["hadoop"]),
    (_rx("log4j"),           ["log4j", "security"]),
    (_rx("webkit"),          ["webkit", "browser-engine"]),
    (_rx("ffmpeg"),          ["ffmpeg", "video"]),
    (_rx("nginx"),           ["nginx"]),
    (_rx("langchain"),       ["langchain", "ai"]),
    (_rx("mlflow"),          ["mlflow", "ml"]),
    (_rx("langgraph"),       ["langgraph", "ai"]),
    (_rx("react-native"),    ["react-native", "mobile"]),
    (re.compile(r"\breact\b(?! native)", re.I), ["react"]),
    (_rx("next.js", "nextjs"), ["nextjs"]),
    (_rx("nuxt"),            ["nuxt"]),
    (_rx("angular"),         ["angular"]),
    (_rx("svelte"),          ["svelte"]),
    (_rx("express.js", "express"), ["express", "nodejs"]),
    (_rx("nestjs"),          ["nestjs", "nodejs"]),
    (_rx("flask"),           ["flask"]),
    (_rx("django"),          ["django"]),
    (_rx("spring boot", "spring-boot"), ["spring-boot"]),
    (_rx("kubernetes", "k8s"), ["kubernetes"]),
    (_rx("docker", "containerized"), ["docker"]),
    (_rx("helm"),            ["helm"]),
    (_rx("argocd", "argo cd"), ["argocd", "gitops"]),
    (_rx("gitops"),          ["gitops"]),
    (_rx("postgres", "postgresql"), ["postgres"]),
    (_rx("mysql"),           ["mysql"]),
    (_rx("mongodb"),         ["mongodb"]),
    (_rx("redis"),           ["redis"]),
    (_rx("graphql"),         ["graphql"]),
    (_rx("grpc"),            ["grpc"]),
    (_rx("websocket"),       ["websocket"]),
    (_rx("chaos monkey", "chaos engineering"), ["chaos-engineering"]),
    (_rx("cobol"),           ["cobol"]),
    (_rx("mainframe"),       ["mainframe"]),
    (_rx("wso2"),            ["wso2", "integration"]),
    (_rx("trino"),           ["trino"]),
    (_rx("dbt"),             ["dbt"]),
    (_rx("observability", "opentelemetry"), ["observability"]),
    (_rx("vault"),           ["vault"]),
    (_rx("mendix"),          ["mendix"]),
    (_rx("temporal.io", "temporal"), ["temporal"]),
    (_rx("triton"),          ["gpu"]),
    (_rx("llm"),             ["ai", "llm"]),
    (_rx("chatbot"),         ["ai", "chatbot"]),
    (_rx("nlp"),             ["ai", "nlp"]),
    (_rx("accessibility", "wcag"), ["accessibility"]),
    (_rx("microservices"),   ["microservices"]),
    (_rx("module federation"), ["module-federation"]),
    (_rx("design system"),   ["design-system"]),
    (_rx("frontend"),        ["frontend"]),
    (_rx("backend"),         ["backend"]),
    (_rx("mavlink", "ros2", "ros1"), ["robotics"]),
    (_rx("electronic design automation"), ["eda"]),
    (_rx("compiler"),        ["compiler"]),
    (_rx("odoo"),            ["odoo", "erp"]),
    (_rx("erp"),             ["erp"]),
    (_rx("crm"),             ["crm"]),
    (_rx("marketplace"),     ["marketplace"]),
    (_rx("artificial intelligence"), ["ai"]),
    (re.compile(r"\bai[- ]", re.I),  ["ai"]),
    (re.compile(r"\bml\b(?!p)", re.I), ["ml"]),
    # Name-only patterns for repos with no PR/guide data
    (re.compile(r"\bmca[- ]solution", re.I),                       ["banking", "document-processing"]),
    (re.compile(r"\bmicrosoft[- ](excel|word|powerpoint)", re.I),  ["office"]),
    (re.compile(r"\bcreate[- ]excel", re.I),                       ["office"]),
    (re.compile(r"ai[- ]powered", re.I),                           ["ai"]),
    (re.compile(r"\bexpense[- ]management", re.I),                 ["finance"]),
    (re.compile(r"marketplace", re.I),                             ["marketplace"]),
    (re.compile(r"mobile[- ]app", re.I),                           ["mobile"]),
    (re.compile(r"mediawiki", re.I),                               ["wiki"]),
    (re.compile(r"\bpodcast\b", re.I),                             ["media"]),
    (re.compile(r"blockchain", re.I),                              ["blockchain"]),
    (re.compile(r"\bcrypto\b", re.I),                              ["crypto"]),
]


def infer_extra_tags(name: str, description: str,
                     pr_title: str | None, guide_title: str | None) -> set[str]:
    text = " ".join(filter(None, [name, description, pr_title, guide_title]))
    tags: set[str] = set()
    for regex, out_tags in TAG_RULES:
        if regex.search(text):
            tags.update(out_tags)
    return tags


def get_latest_blitzy_pr(org: str, repo: str, token: str) -> tuple[str | None, str | None]:
    """Return (pr_title, head_branch) for the most recent Blitzy PR, or (None, None)."""
    try:
        prs = gh(f"/repos/{org}/{repo}/pulls?state=all&per_page=5", token)
    except urllib.error.HTTPError:
        return None, None
    blitzy_prs = [
        p for p in (prs or [])
        if (p.get("head") or {}).get("ref", "").startswith("blitzy-")
        or (p.get("user") or {}).get("login") == "blitzy[bot]"
    ]
    if not blitzy_prs:
        return None, None
    latest = sorted(blitzy_prs, key=lambda p: p.get("created_at", ""), reverse=True)[0]
    return latest.get("title"), (latest.get("head") or {}).get("ref")


def get_guide_title(org: str, repo: str, branch: str, token: str) -> str | None:
    if not branch:
        return None
    try:
        data = gh(
            f"/repos/{org}/{repo}/contents/{urllib.parse.quote('blitzy/documentation/Project Guide.md')}?ref={branch}",
            token,
        )
    except urllib.error.HTTPError:
        return None
    if not data or data.get("encoding") != "base64":
        return None
    content = base64.b64decode(data["content"]).decode("utf-8", errors="ignore")
    for line in content.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return None


def gh(path: str, token: str):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def list_org_repos(org: str, token: str) -> list[dict]:
    repos, page = [], 1
    while True:
        batch = gh(f"/orgs/{org}/repos?per_page=100&page={page}&type=all", token)
        if not batch:
            break
        repos.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return repos


def get_top_language(org: str, repo: str, token: str) -> str | None:
    try:
        langs = gh(f"/repos/{org}/{repo}/languages", token)
    except urllib.error.HTTPError:
        return None
    if not langs:
        return None
    return max(langs, key=langs.get)


def infer_spec_type(name: str, description: str) -> str:
    text = (name + " " + description).lower()
    if any(w in text for w in ["library", "framework", "sdk", "package", "interpreter", "libprov"]):
        return "library"
    if any(w in text for w in ["dashboard", "frontend", "web app", "portal", "website", "storefront", "reveal.js"]):
        return "website"
    if any(w in text for w in ["tool", "cli", "compiler", "editor", "terminal", "emulator",
                                 "fuzzer", "monitor", "notepad", "iterm", "openroad", "eda", "linter", "scanner"]):
        return "tool"
    if any(w in text for w in ["documentation", "tutorial", "guide", "docs"]):
        return "documentation"
    return "service"


def safe_entity_name(name: str) -> str:
    normalized = ENTITY_NAME_RE.sub("-", name).lower()
    normalized = re.sub(r"-+", "-", normalized).strip("-.")
    return normalized[:63] or "unnamed"


def strip_fork_prefix(description: str) -> str:
    for prefix in ["Blitzy fork of ", "Blitzy fork - ", "blitzy fork of ", "blitzy fork - "]:
        if description.lower().startswith(prefix.lower()):
            return description[len(prefix):]
    return description


def load_verticals() -> dict:
    if not os.path.exists(VERTICALS_FILE):
        return {}
    with open(VERTICALS_FILE) as f:
        return json.load(f)


def build_component(repo: dict, token: str, org: str, verticals: dict) -> dict:
    name = repo["name"]
    default_branch = repo["default_branch"]
    description = strip_fork_prefix((repo.get("description") or "").strip())

    github_lang = repo.get("language") or get_top_language(org, name, token)
    language_tag = GITHUB_LANG_TO_TAG.get(github_lang) if github_lang else None

    pr_title, pr_branch = get_latest_blitzy_pr(org, name, token)
    guide_title = get_guide_title(org, name, pr_branch, token) if pr_branch else None
    extra_tags = infer_extra_tags(name, description, pr_title, guide_title)

    topics = repo.get("topics") or []
    seed_tags: set[str] = {t for t in topics if re.fullmatch(r"[a-z0-9+#\-]+", t)}
    if language_tag:
        seed_tags.add(language_tag)
    tags = sorted(seed_tags | extra_tags)

    entity: dict = {
        "apiVersion": "backstage.io/v1alpha1",
        "kind": "Component",
        "metadata": {
            "name": safe_entity_name(name),
            "title": name,
            "description": description or f"Blitzy public sample: {name}",
            "tags": tags,
            "annotations": {
                "github.com/project-slug": f"{org}/{name}",
                "backstage.io/source-location": f"url:https://github.com/{org}/{name}/tree/{default_branch}/",
            },
        },
        "spec": {
            "type": infer_spec_type(name, description),
            "lifecycle": "experimental",
            "owner": GROUP,
            "system": SYSTEM,
        },
    }

    labels: dict[str, str] = {}
    if language_tag:
        labels["blitzy.com/language"] = language_tag
    vertical_entry = verticals.get(name)
    vertical_value = (vertical_entry or {}).get("vertical")
    # Only label real verticals — leave "no-fit" samples unlabeled so the
    # picker/column omits them entirely.
    if vertical_value and vertical_value != "no-fit":
        labels["blitzy.com/vertical"] = vertical_value
    if labels:
        entity["metadata"]["labels"] = labels

    return entity


def build_group() -> dict:
    return {
        "apiVersion": "backstage.io/v1alpha1",
        "kind": "Group",
        "metadata": {
            "name": GROUP,
            "description": "Owner group for Blitzy public sample projects generated on the Blitzy Platform",
        },
        "spec": {
            "type": "team",
            "children": [],
        },
    }


def build_system() -> dict:
    return {
        "apiVersion": "backstage.io/v1alpha1",
        "kind": "System",
        "metadata": {
            "name": SYSTEM,
            "description": "Blitzy Platform public sample projects — https://github.com/blitzy-public-samples",
            "tags": ["samples", "blitzy-platform"],
        },
        "spec": {
            "owner": GROUP,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--org", default=ORG)
    parser.add_argument("--output", default=OUTPUT_FILE)
    parser.add_argument("--dry-run", action="store_true", help="Print summary; do not write file")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN is not set.", file=sys.stderr)
        sys.exit(1)

    print(f"Fetching repos in {args.org} ...")
    repos = list_org_repos(args.org, token)
    print(f"  {len(repos)} repos discovered")

    verticals = load_verticals()
    print(f"  {len(verticals)} entries in vertical mapping ({VERTICALS_FILE})")

    documents = [build_group(), build_system()]

    langs_resolved = 0
    langs_missing = 0
    vertical_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}
    for i, repo in enumerate(repos, 1):
        entity = build_component(repo, token, args.org, verticals)
        spec_type = entity["spec"]["type"]
        type_counts[spec_type] = type_counts.get(spec_type, 0) + 1
        labels = entity["metadata"].get("labels", {})
        if labels.get("blitzy.com/language"):
            langs_resolved += 1
        else:
            langs_missing += 1
        vertical = labels.get("blitzy.com/vertical") or "(unset)"
        vertical_counts[vertical] = vertical_counts.get(vertical, 0) + 1
        documents.append(entity)
        if i % 25 == 0:
            print(f"  processed {i}/{len(repos)}")
        time.sleep(0.05)

    print()
    print("=" * 60)
    print(f"Group:      1 ({GROUP})")
    print(f"System:     1 ({SYSTEM})")
    print(f"Components: {len(repos)}")
    print(f"  with language tag: {langs_resolved}")
    print(f"  without language:  {langs_missing}")
    print("  by vertical:")
    for v, n in sorted(vertical_counts.items(), key=lambda kv: -kv[1]):
        print(f"    {n:>4}  {v}")
    print("  by spec.type:")
    for t, n in sorted(type_counts.items(), key=lambda kv: -kv[1]):
        print(f"    {n:>4}  {t}")
    print("=" * 60)

    if args.dry_run:
        print("\nDRY RUN — no file written")
        return

    with open(args.output, "w", encoding="utf-8") as f:
        f.write("# Auto-generated by scripts/generate_public_samples_catalog.py\n")
        f.write(f"# Source: https://github.com/{args.org}\n")
        f.write("# Re-run the script to refresh. Do not hand-edit.\n")
        yaml.dump_all(documents, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
