#!/usr/bin/env python3
"""
Syncs tags in Backstage catalog-info.yaml files.

Two tag sources per repo:
  1. Language  — from the `blitzy.com/language` label in catalog-info.yaml
  2. Project type — derived from the Project Guide title in the blitzy branch

Special case: blitzy-sandbox-backstage is updated in the local
catalog-blitzy-sandbox.yaml rather than the in-repo catalog-info.yaml.

Usage:
    GITHUB_TOKEN=<token> python3 scripts/sync_catalog_tags.py          # dry run
    GITHUB_TOKEN=<token> python3 scripts/sync_catalog_tags.py --apply  # write changes
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
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml not installed. Run: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

ORG = "Blitzy-Sandbox"
REPO_ROOT = Path(__file__).parent.parent
LOCAL_CATALOG = REPO_ROOT / "catalog-blitzy-sandbox.yaml"
LOCAL_REPO = "blitzy-sandbox-backstage"

# ---------------------------------------------------------------------------
# Title keyword → project-type tags
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
    (["poc", "proof of concept"],              ["proof-of-concept"]),
    (["pipeline"],                             ["data-pipeline"]),
    (["extension"],                            ["new-feature"]),
    (["configurator"],                         ["frontend", "new-feature"]),
    (["intelligence"],                         ["ai", "new-feature"]),
]


def project_type_tags(title: str) -> list[str]:
    t = title.lower()
    tags: set[str] = set()
    for keywords, tag_list in TITLE_RULES:
        if any(kw in t for kw in keywords):
            tags.update(tag_list)
    return sorted(tags)


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


def fetch_file_with_meta(org: str, repo: str, path: str, ref: str, token: str) -> tuple[str, str] | None:
    """Returns (decoded_content, sha) or None if not found."""
    try:
        data = gh(f"/repos/{org}/{repo}/contents/{urllib.parse.quote(path)}?ref={ref}", token)
        if data.get("encoding") == "base64":
            content = base64.b64decode(data["content"]).decode("utf-8")
            return content, data["sha"]
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    return None


def fetch_file(org: str, repo: str, path: str, ref: str, token: str) -> str | None:
    result = fetch_file_with_meta(org, repo, path, ref, token)
    return result[0] if result else None


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
    content = fetch_file(org, repo, "blitzy/documentation/Project Guide.md", branch, token)
    if not content:
        return None
    for line in content.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return None


def push_file(org: str, repo: str, path: str, content: str, sha: str, message: str, token: str):
    gh(
        f"/repos/{org}/{repo}/contents/{urllib.parse.quote(path)}",
        token,
        method="PUT",
        body={
            "message": message,
            "content": base64.b64encode(content.encode()).decode(),
            "sha": sha,
        },
    )


# ---------------------------------------------------------------------------
# YAML helpers
# ---------------------------------------------------------------------------

def catalog_tags(content: str) -> set[str]:
    tags: set[str] = set()
    for doc in yaml.safe_load_all(content):
        if not doc:
            continue
        for t in (doc.get("metadata") or {}).get("tags") or []:
            tags.add(t)
    return tags


def catalog_language(content: str) -> str | None:
    for doc in yaml.safe_load_all(content):
        if not doc:
            continue
        labels = (doc.get("metadata") or {}).get("labels") or {}
        lang = labels.get("blitzy.com/language")
        if lang:
            return lang.lower()
    return None


def add_tags_to_yaml(content: str, tags_to_add: set[str], entity_name: str | None = None) -> str:
    """
    Parse a (possibly multi-document) YAML, add tags_to_add to every document
    (or only the one matching entity_name), and return the serialized result.
    """
    docs = list(yaml.safe_load_all(content))
    for doc in docs:
        if not doc:
            continue
        meta = doc.get("metadata") or {}
        if entity_name and meta.get("name") != entity_name:
            continue
        existing = set(meta.get("tags") or [])
        meta["tags"] = sorted(existing | tags_to_add)
        doc["metadata"] = meta

    return yaml.dump_all(
        docs,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--org", default=ORG)
    parser.add_argument("--apply", action="store_true", help="Write changes (default: dry run)")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: GITHUB_TOKEN is not set.", file=sys.stderr)
        sys.exit(1)

    org = args.org
    dry_run = not args.apply

    if dry_run:
        print("DRY RUN — pass --apply to write changes\n")

    print(f"Fetching repos in {org} ...")
    repos = list_org_repos(org, token)
    print(f"Found {len(repos)} repos\n")

    results = []

    for repo in repos:
        name = repo["name"]
        default_branch = repo["default_branch"]
        is_local = (name == LOCAL_REPO)

        # Read catalog-info.yaml (use local file for blitzy-sandbox-backstage)
        if is_local:
            catalog_content = LOCAL_CATALOG.read_text()
            catalog_sha = None
        else:
            result = fetch_file_with_meta(org, name, "catalog-info.yaml", default_branch, token)
            if not result:
                continue
            catalog_content, catalog_sha = result

        existing = catalog_tags(catalog_content)
        language = catalog_language(catalog_content)
        to_add: set[str] = set()
        title_used = None

        # Source 1: language label
        if language and language not in existing:
            to_add.add(language)

        # Source 2: project type from blitzy branch
        branch = get_blitzy_branch(org, name, token)
        if branch:
            title_used = get_project_guide_title(org, name, branch, token)
            if title_used:
                for tag in project_type_tags(title_used):
                    if tag not in existing:
                        to_add.add(tag)

        time.sleep(0.05)

        results.append({
            "repo": name,
            "is_local": is_local,
            "catalog_sha": catalog_sha,
            "default_branch": default_branch,
            "existing_tags": sorted(existing),
            "language": language,
            "guide_title": title_used,
            "tags_to_add": sorted(to_add),
        })

        status = f"  +{sorted(to_add)}" if to_add else "  (in sync)"
        print(f"  {'[local] ' if is_local else ''}{name:50s}{status}")

    # --- Report ---
    needs_update = [r for r in results if r["tags_to_add"]]
    in_sync      = [r for r in results if not r["tags_to_add"]]

    print()
    print("=" * 70)
    print(f"TAG SYNC REPORT  —  {len(results)} repos with catalog-info.yaml")
    print("=" * 70)
    print(f"  Needs update   : {len(needs_update)}")
    print(f"  Already in sync: {len(in_sync)}")

    if needs_update:
        print()
        print("REPOS THAT NEED TAG UPDATES:")
        print("─" * 70)
        for r in needs_update:
            src = "(local catalog-blitzy-sandbox.yaml)" if r["is_local"] else f"(catalog-info.yaml on {r['default_branch']})"
            print(f"\n  {r['repo']}  {src}")
            print(f"    Guide title  : {r['guide_title'] or '(none)'}")
            print(f"    Current tags : {r['existing_tags'] or '(none)'}")
            print(f"    Tags to ADD  : {r['tags_to_add']}")

    print()

    # --- Apply ---
    if dry_run:
        if needs_update:
            print("Run with --apply to write these changes.")
        else:
            print("All catalog files are in sync.")
        return

    print("Applying changes ...")
    for r in needs_update:
        name = r["repo"]
        to_add = set(r["tags_to_add"])

        if r["is_local"]:
            updated = add_tags_to_yaml(LOCAL_CATALOG.read_text(), to_add, entity_name=name)
            LOCAL_CATALOG.write_text(updated)
            print(f"  [local] {name}  wrote {LOCAL_CATALOG.name}")
        else:
            result = fetch_file_with_meta(org, name, "catalog-info.yaml", r["default_branch"], token)
            if not result:
                print(f"  SKIP {name} — could not re-fetch catalog-info.yaml")
                continue
            content, sha = result
            updated = add_tags_to_yaml(content, to_add)
            push_file(
                org, name, "catalog-info.yaml", updated, sha,
                f"chore: sync catalog tags ({', '.join(sorted(to_add))})",
                token,
            )
            print(f"  {name}  committed +{sorted(to_add)}")
            time.sleep(0.2)

    print("\nDone.")


if __name__ == "__main__":
    main()
