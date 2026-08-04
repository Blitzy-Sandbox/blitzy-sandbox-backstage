#!/usr/bin/env python3
"""
Creates catalog-info.yaml for blitzy-* repos that don't have one.

Derives:
  - description  from GitHub repo metadata
  - language tag from GitHub-reported language
  - project type from blitzy branch Project Guide title
  - spec.type    inferred from repo name + description
  - system       mapped from language

Usage:
    GITHUB_TOKEN=<token> python3 scripts/create_catalog_entries.py          # preview
    GITHUB_TOKEN=<token> python3 scripts/create_catalog_entries.py --apply  # commit
"""

import argparse
import base64
import json
import os
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

ORG = "Blitzy-Sandbox"

# ---------------------------------------------------------------------------
# Language mappings
# ---------------------------------------------------------------------------

GITHUB_LANG_TO_TAG: dict[str, str] = {
    "TypeScript":  "typescript",
    "JavaScript":  "javascript",
    "Python":      "python",
    "Go":          "go",
    "Java":        "java",
    "Rust":        "rust",
    "C":           "c",
    "C++":         "cpp",
    "C#":          "csharp",
    "PHP":         "php",
    "Solidity":    "solidity",
    "Verilog":     "verilog",
    "Ruby":        "ruby",
    "Kotlin":      "kotlin",
    "Swift":       "swift",
    "Shell":       "shell",
}

LANG_TO_SYSTEM: dict[str, str] = {
    "typescript":  "blitzy-typescript",
    "javascript":  "blitzy-typescript",
    "python":      "blitzy-python",
    "go":          "blitzy-go",
    "java":        "blitzy-java",
    "rust":        "blitzy-rust",
    "c":           "blitzy-c-cpp",
    "cpp":         "blitzy-c-cpp",
    "csharp":      "blitzy-dotnet",
}

# ---------------------------------------------------------------------------
# Title keyword → project-type tags (same rules as sync script)
# ---------------------------------------------------------------------------

TITLE_RULES: list[tuple[list[str], list[str]]] = [
    (["shuffle"],                              ["new-feature"]),
    (["test suite"],                           ["test-suite"]),
    (["decomposition"],                        ["refactor"]),
    (["audit"],                                ["audit", "documentation"]),
    (["migration"],                            ["migration", "refactor"]),
    (["rebrand"],                              ["frontend", "design"]),
    (["modernization"],                        ["modernization", "refactor"]),
    (["rewrite"],                              ["refactor"]),
    (["feature", "enhancement", "addition"],   ["new-feature"]),
]


def project_type_tags(title: str) -> list[str]:
    t = title.lower()
    tags: set[str] = set()
    for keywords, tag_list in TITLE_RULES:
        if any(kw in t for kw in keywords):
            tags.update(tag_list)
    return sorted(tags)


def infer_spec_type(name: str, description: str) -> str:
    text = (name + " " + description).lower()
    if any(w in text for w in ["library", "framework", "sdk", "package", "interpreter", "libprov"]):
        return "library"
    if any(w in text for w in ["dashboard", "frontend", "web app", "portal", "website"]):
        return "website"
    if any(w in text for w in ["tool", "cli", "compiler", "editor", "terminal", "emulator",
                                 "fuzzer", "monitor", "notepad", "iterm", "openroad", "eda"]):
        return "tool"
    return "service"


# ---------------------------------------------------------------------------
# GitHub API
# ---------------------------------------------------------------------------

def gh(path: str, token: str, method: str = "GET", body: dict | None = None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
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


def has_catalog_yaml(org: str, repo: str, branch: str, token: str) -> bool:
    try:
        gh(f"/repos/{org}/{repo}/contents/catalog-info.yaml?ref={branch}", token)
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


def get_top_language(org: str, repo: str, token: str) -> str | None:
    # GitHub's `repo.language` is often null for forks until linguist runs.
    # `/languages` returns a byte-count breakdown that's populated regardless.
    try:
        langs = gh(f"/repos/{org}/{repo}/languages", token)
    except urllib.error.HTTPError:
        return None
    if not langs:
        return None
    return max(langs, key=langs.get)


def get_blitzy_branch(org: str, repo: str, token: str) -> str | None:
    try:
        branches = gh(f"/repos/{org}/{repo}/branches?per_page=100", token)
        for b in branches:
            if b["name"].startswith("blitzy-"):
                return b["name"]
    except urllib.error.HTTPError:
        pass
    return None


def get_project_guide_title(org: str, repo: str, branch: str, token: str) -> str | None:
    try:
        data = gh(f"/repos/{org}/{repo}/contents/{urllib.parse.quote('blitzy/documentation/Project Guide.md')}?ref={branch}", token)
        if data.get("encoding") == "base64":
            content = base64.b64decode(data["content"]).decode("utf-8")
            for line in content.splitlines():
                if line.startswith("# "):
                    return line[2:].strip()
    except urllib.error.HTTPError:
        pass
    return None


def commit_file(org: str, repo: str, path: str, content: str, message: str, branch: str, token: str):
    gh(
        f"/repos/{org}/{repo}/contents/{urllib.parse.quote(path)}",
        token,
        method="PUT",
        body={
            "message": message,
            "content": base64.b64encode(content.encode()).decode(),
            "branch": branch,
        },
    )


# ---------------------------------------------------------------------------
# Catalog YAML generation
# ---------------------------------------------------------------------------

def build_catalog_yaml(
    name: str,
    description: str,
    tags: list[str],
    language: str | None,
    spec_type: str,
    system: str,
    default_branch: str,
) -> str:
    entity: dict = {
        "apiVersion": "backstage.io/v1alpha1",
        "kind": "Component",
        "metadata": {
            "name": name,
            "description": description or f"Blitzy Sandbox project: {name}",
            "tags": sorted(tags),
            "annotations": {
                "github.com/project-slug": f"{ORG}/{name}",
                "backstage.io/source-location": f"url:https://github.com/{ORG}/{name}/tree/{default_branch}/",
                "backstage.io/techdocs-ref": "dir:.",
            },
        },
        "spec": {
            "type": spec_type,
            "lifecycle": "production",
            "owner": "blitzy-sandbox",
            "system": system,
        },
    }

    if language:
        entity["metadata"]["labels"] = {"blitzy.com/language": language}

    return yaml.dump(entity, default_flow_style=False, allow_unicode=True, sort_keys=False)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--org", default=ORG)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN is not set.", file=sys.stderr)
        sys.exit(1)

    org = args.org
    dry_run = not args.apply

    if dry_run:
        print("DRY RUN — pass --apply to commit files\n")

    print(f"Fetching repos in {org} ...")
    all_repos = list_org_repos(org, token)

    # Filter to blitzy-* repos without catalog-info.yaml
    candidates = []
    for repo in all_repos:
        name = repo["name"]
        if not name.startswith("blitzy-"):
            continue
        if has_catalog_yaml(org, name, repo["default_branch"], token):
            continue
        candidates.append(repo)
        time.sleep(0.05)

    print(f"Found {len(candidates)} blitzy-* repos without catalog-info.yaml\n")

    entries = []

    for repo in candidates:
        name = repo["name"]
        default_branch = repo["default_branch"]
        github_lang = repo.get("language") or get_top_language(org, name, token)
        description = (repo.get("description") or "").strip()

        # Strip "Blitzy fork of/- " prefix from descriptions
        for prefix in ["Blitzy fork of ", "Blitzy fork - ", "blitzy fork of ", "blitzy fork - "]:
            if description.lower().startswith(prefix.lower()):
                description = description[len(prefix):]
                break

        language_tag = GITHUB_LANG_TO_TAG.get(github_lang) if github_lang else None
        spec_type = infer_spec_type(name, description)
        system = LANG_TO_SYSTEM.get(language_tag, "blitzy-sandbox-projects") if language_tag else "blitzy-sandbox-projects"

        tags: set[str] = set()
        if language_tag:
            tags.add(language_tag)

        # Get project type from blitzy branch
        blitzy_branch = get_blitzy_branch(org, name, token)
        guide_title = None
        if blitzy_branch:
            guide_title = get_project_guide_title(org, name, blitzy_branch, token)
            if guide_title:
                tags.update(project_type_tags(guide_title))

        time.sleep(0.05)

        catalog_content = build_catalog_yaml(
            name=name,
            description=description,
            tags=sorted(tags),
            language=language_tag,
            spec_type=spec_type,
            system=system,
            default_branch=default_branch,
        )

        entries.append({
            "name": name,
            "default_branch": default_branch,
            "description": description,
            "language": language_tag,
            "guide_title": guide_title,
            "spec_type": spec_type,
            "system": system,
            "tags": sorted(tags),
            "catalog_content": catalog_content,
        })

        print(f"  {name}")
        print(f"    type={spec_type}  language={language_tag or '?'}  system={system}")
        print(f"    tags={sorted(tags)}")
        print(f"    guide={guide_title or '(none)'}")
        print()

    print("=" * 70)
    print(f"CATALOG CREATION REPORT  —  {len(entries)} files to create")
    print("=" * 70)
    print()

    if dry_run:
        print("Run with --apply to commit catalog-info.yaml to each repo.")
        return

    print("Committing catalog-info.yaml files ...")
    for e in entries:
        try:
            commit_file(
                org, e["name"], "catalog-info.yaml",
                e["catalog_content"],
                f"chore: add catalog-info.yaml",
                e["default_branch"],
                token,
            )
            print(f"  ✓ {e['name']}")
        except Exception as ex:
            print(f"  ✗ {e['name']}  ERROR: {ex}")
        time.sleep(0.2)

    print("\nDone.")


if __name__ == "__main__":
    main()
