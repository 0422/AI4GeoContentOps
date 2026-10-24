# 2026-10-24：本次修改原因：旧库只读备份后在全新副本执行 Stage 2A 迁移演练，保留旧 ID、原始记录与不可恢复语义报告。
"""Offline rehearsal only. Never writes to the source SQLite database."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from uuid import NAMESPACE_URL, uuid5


BACKEND = Path(__file__).resolve().parents[1]
LEGACY_DEFAULT = BACKEND / "data" / "tasks.db"


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def legacy_utc(value: object) -> str | None:
    """Old ORM system timestamps were written as UTC; SQLite dropped the offset."""
    if value is None:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def j(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def digest(value: object) -> str:
    data = value if isinstance(value, bytes) else str(value).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def stable(table: str, key: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"ai4geo/stage2a/{table}/{key}"))


def decode(value: str | None, fallback: object) -> object:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def rows(connection: sqlite3.Connection, table: str) -> list[dict]:
    return [dict(row) for row in connection.execute(f"SELECT * FROM {table}")]


def preflight(connection: sqlite3.Connection) -> dict:
    """Read-only legacy shape and orphan checks before creating the target schema."""
    tables = {row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    required = {"tasks", "content_samples", "article_metadata", "article_metrics", "content_strategies", "brands"}
    report = {"tables": sorted(tables), "missing_required": sorted(required - tables), "counts": {},
              "orphan_metrics": [], "orphan_strategy_references": [], "checked_at": stamp()}
    for table in sorted(tables):
        report["counts"][table] = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    if report["missing_required"]:
        return report
    sample_ids = {row[0] for row in connection.execute("SELECT id FROM content_samples")}
    report["orphan_metrics"] = [row[0] for row in connection.execute("SELECT id, sample_id FROM article_metrics")
                                if row[1] not in sample_ids]
    if "content_strategy_references" in tables:
        strategy_ids = {row[0] for row in connection.execute("SELECT id FROM content_strategies")}
        report["orphan_strategy_references"] = [row[0] for row in connection.execute(
            "SELECT id, strategy_id FROM content_strategy_references") if row[1] not in strategy_ids]
    return report


def put(connection: sqlite3.Connection, table: str, values: dict) -> None:
    cols = list(values)
    connection.execute(
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
        [values[name] for name in cols],
    )


def mapped(connection: sqlite3.Connection, old_table: str, old_id: str, new_table: str, new_id: str, checksum: str) -> None:
    put(connection, "legacy_id_map", dict(legacy_table=old_table, legacy_id=old_id,
        target_table=new_table, target_id=new_id, migrated_at=stamp(), checksum=checksum))


def count_value(raw: object) -> tuple[str | None, int | None, int | None]:
    if raw is None:
        return None, None, None
    raw_string = str(raw).strip()
    if raw_string.isdecimal():
        return raw_string, int(raw_string), None
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([wW万])\s*\+", raw_string)
    if match:
        return raw_string, None, int(float(match.group(1)) * 10000)
    return raw_string, None, None


def _article_projection(sample: dict, meta: dict | None) -> tuple[dict, dict, dict]:
    source_data = decode(meta.get("source_data_json") if meta else None, {})
    if not isinstance(source_data, dict):
        source_data = {}
    response = source_data.get("response")
    if not isinstance(response, dict):
        response = {}
    provenance = {}
    for new_name, old_name in (
        ("title", "title"), ("body_text", "body_text"), ("platform_id", "platform_id"),
        ("category_id", "category_id"), ("article_url", "source_url"),
    ):
        provenance[new_name] = {"origin": "legacy", "source_path": f"content_samples.{old_name}",
                                "status": "legacy_unverified"}
    for new_name, old_name in (("author_name", "author_id"), ("published_at", "published_at"),
                               ("summary", "source_data_json.response.summary")):
        provenance[new_name] = {"origin": "legacy", "source_path": f"article_metadata.{old_name}",
                                "status": "legacy_unverified"}
    return source_data, response, provenance


def migrate(legacy: sqlite3.Connection, target: sqlite3.Connection) -> dict:
    legacy_tables = [row[0] for row in legacy.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    expected = {"tasks", "content_samples", "article_metadata", "article_metrics", "content_strategies", "brands"}
    missing = sorted(expected - set(legacy_tables))
    if missing:
        raise RuntimeError(f"Legacy schema missing required tables: {missing}")
    report = {"source_counts": {}, "archived_counts": {}, "target_entity_counts": {},
        "active_mapping_counts": {}, "active_mapping_gaps": {}, "unrecoverable": [
        "Old rights_confirmed has no verified third-party LLM scope",
        "Old source content completeness is unverified",
        "Historical feature preparation/config versions are unknown",
        "Old task prompt/model permissions cannot be reconstructed",
        "Legacy SQLite system timestamps lacked timezone offsets; UTC is inferred from old ORM defaults",
    ], "warnings": [], "hash_mismatches": [], "archive_mismatches": []}
    cache = {name: rows(legacy, name) for name in legacy_tables}
    report["source_counts"] = {name: len(items) for name, items in cache.items()}
    # 2026-10-24：本次修改原因：每一条旧记录先归档，映射失败时仍可按旧 ID 检索原值。
    for table, items in cache.items():
        primary_columns = [column[1] for column in legacy.execute(f"PRAGMA table_info({table})") if column[5]]
        for index, row in enumerate(items):
            key = ":".join(str(row[column]) for column in primary_columns) if primary_columns else f"row-{index}"
            payload = j(row)
            put(target, "legacy_payload_archive", dict(legacy_table=table, legacy_id=key,
                payload_json=payload, payload_hash=digest(payload), migration_status="archived",
                archived_at=stamp()))
            mapped(target, table, key, "legacy_payload_archive", f"{table}:{key}", digest(payload))
    for table in ("content_options", "brands", "llm_settings"):
        for row in cache.get(table, []):
            target_row = dict(row)
            if table == "brands":
                target_row["created_at"] = legacy_utc(row["created_at"])
            put(target, table, target_row)
            mapped(target, table, str(row["id"]), table, str(row["id"]), digest(j(row)))

    metadata = {r["sample_id"]: r for r in cache.get("article_metadata", [])}
    sample_titles = {r["id"]: r["title"] for r in cache["content_samples"]}
    sample_ids = set()
    for sample in cache["content_samples"]:
        sample_id = sample["id"]
        sample_ids.add(sample_id)
        meta = metadata.get(sample_id)
        if meta and meta.get("source_data_json"):
            try:
                json.loads(meta["source_data_json"])
            except (TypeError, ValueError):
                report["warnings"].append(f"unparseable article_metadata.source_data_json for {sample_id}; original archived")
        source_data, response, provenance = _article_projection(sample, meta)
        revision_id = stable("article_revisions", sample_id)
        source_id = stable("article_sources", sample_id)
        rights_id = stable("rights_decisions", sample_id)
        created = legacy_utc(sample["created_at"])
        summary = response.get("summary") if isinstance(response.get("summary"), str) else None
        author = meta.get("author_id") if meta else None
        published = meta.get("published_at") if meta else None
        tags = decode(meta.get("tags_json") if meta else None, [])
        if not isinstance(tags, list):
            tags = []
        article = dict(id=sample_id, platform_id=sample["platform_id"], category_id=sample["category_id"],
            content_format_id=sample["format_id"], genre_id=None, audience_id=meta.get("audience_id") if meta else None,
            topic=meta.get("topic") if meta else None, tags_json=j(tags), title=sample["title"],
            summary=summary, body_text=sample["body_text"], author_name=author, published_at=published,
            article_url=sample["source_url"], canonical_url=None,
            review_status=meta.get("review_status", "legacy_unverified") if meta else "legacy_unverified",
            content_status="unknown" if sample["body_text"] else "missing",
            rights_status="unknown", rights_scope_json=j({"legacy_confirmation": bool(sample["rights_confirmed"])}),
            rights_evidence=meta.get("usage_rights_note") if meta else None, quality_score=sample["quality_score"],
            current_revision_no=1, current_revision_id=None, field_provenance_json=j(provenance), row_version=1,
            collected_at=legacy_utc(meta["collected_at"]) if meta else created, deleted_at=None,
            created_at=created, updated_at=created)
        put(target, "articles", article)
        snapshot = {key: article[key] for key in ("platform_id", "category_id", "content_format_id", "genre_id",
            "audience_id", "topic", "title", "summary", "body_text", "author_name",
            "published_at", "article_url", "review_status", "content_status", "quality_score")}
        snapshot["tags"] = tags
        put(target, "article_revisions", dict(id=revision_id, article_id=sample_id, revision_number=1,
            title=sample["title"], summary=summary, body_text=sample["body_text"], author_name=author,
            published_at=published, category_id=sample["category_id"], content_format_id=sample["format_id"],
            genre_id=None, article_url=sample["source_url"], snapshot_json=j(snapshot),
            field_provenance_json=j(provenance), edited_fields_json="[]", editor_note="legacy import",
            created_at=created))
        target.execute("UPDATE articles SET current_revision_id=? WHERE id=?", (revision_id, sample_id))
        method = source_data.get("method") or "legacy"
        endpoint = {"ten_w": "ten_w_rank", "original": "original_rank", "keyword": "keyword_search"}.get(method, str(method))
        request = source_data.get("request") if isinstance(source_data.get("request"), dict) else {}
        source_content = response.get("content") if isinstance(response.get("content"), str) else None
        put(target, "article_sources", dict(id=source_id, article_id=sample_id, discovery_candidate_id=None,
            acquisition_method="legacy_import", provider=str(source_data.get("provider") or "unknown"),
            endpoint=endpoint, external_id=str(response.get("photoId") or response.get("workUuid") or "") or None,
            source_url=sample["source_url"], source_category=request.get("type"),
            request_params_json=j(request), response_meta_json="{}", field_mapping_json=j(provenance),
            raw_item_hash=digest(j(response)) if response else None,
            raw_content_hash=digest(source_content) if source_content else None,
            content_format="legacy_unknown", raw_complete=0, parser_version="legacy_unverified",
            warnings_json=j(["Original completeness and provider mapping unverified"]),
            fetched_at=legacy_utc(meta["collected_at"]) if meta else created))
        put(target, "article_source_payloads", dict(source_id=source_id, raw_item_json=j(response),
            raw_content=source_content, stored_at=stamp(), retain_until=None))
        put(target, "rights_decisions", dict(id=rights_id, article_id=sample_id, source_id=source_id,
            status="unknown", scope_json=j({"legacy_confirmation": bool(sample["rights_confirmed"]),
            "store": None, "local_clean": None, "third_party_llm": None, "generation_reference": None}),
            evidence=meta.get("usage_rights_note") if meta else None, policy_version="legacy-import-1",
            supersedes_id=None, effective_at=created, expires_at=None, recorded_at=stamp()))
        mapped(target, "content_samples", sample_id, "articles", sample_id, digest(j(sample)))
        if meta:
            mapped(target, "article_metadata", sample_id, "article_sources", source_id, digest(j(meta)))

    for metric in cache.get("article_metrics", []):
        if metric["sample_id"] not in sample_ids:
            report["warnings"].append(f"orphan metric {metric['id']}")
            continue
        raw_counts = decode(metric.get("raw_counts_json"), {})
        if metric.get("raw_counts_json"):
            try:
                json.loads(metric["raw_counts_json"])
            except (TypeError, ValueError):
                report["warnings"].append(f"unparseable article_metrics.raw_counts_json for {metric['id']}; original archived")
        if not isinstance(raw_counts, dict):
            raw_counts = {}
        source_read = raw_counts.get("reads")
        read_raw, read_exact, read_lower = count_value(source_read if source_read is not None else metric.get("reads"))
        parse_warnings = ["unrecognized read count; original preserved"] if read_raw is not None and read_exact is None and read_lower is None else []
        if read_exact is None and read_lower is None and read_raw is None and metric.get("reads") is not None:
            read_exact = metric["reads"]
        provenance = {field: {"origin": "legacy", "source_path": f"article_metrics.{field}",
            "status": "legacy_unverified"} for field in metric}
        put(target, "article_metrics", dict(id=metric["id"], article_id=metric["sample_id"], source_id=None,
            source_label=metric["source"], observed_at=legacy_utc(metric["captured_at"]), read_raw=read_raw,
            read_exact=read_exact, read_lower_bound=read_lower, likes=metric["likes"],
            watch_count=metric.get("watch_count"), comments=metric["comments"], shares=metric["shares"],
            saves=metric["saves"], rewards=metric.get("reward_count"), fans_count=None,
            interactive_count=metric.get("interactive_count"), impressions=metric["impressions"],
            clicks=metric["clicks"], extra_metrics_json=j(raw_counts), parse_warnings_json=j(parse_warnings),
            field_provenance_json=j(provenance)))
        mapped(target, "article_metrics", metric["id"], "article_metrics", metric["id"], digest(j(metric)))

    # 2026-10-24：本次修改原因：旧特征可追溯但缺少真实 Prepared 版本，迁移为不可直接复用的 legacy_unverified 记录。
    for feature in cache.get("article_features", []):
        article_id = feature["sample_id"]
        if article_id not in sample_ids:
            report["warnings"].append(f"orphan feature {article_id}")
            continue
        revision_id = stable("article_revisions", article_id)
        prepared_id = stable("prepared_articles", article_id)
        input_hash = feature["content_hash"] if re.fullmatch(r"[a-f0-9]{64}", feature["content_hash"] or "") else digest(feature["content_hash"])
        put(target, "prepared_articles", dict(id=prepared_id, article_id=article_id, article_revision_id=revision_id,
            source_id=None, input_origin="revision", input_ref_id=revision_id, input_format="legacy_unknown",
            input_hash=input_hash, content_hash=input_hash, preparation_config_hash=digest("legacy unknown"),
            cleaner_version="legacy_unknown", reused_from_prepared_id=None,
            clean_title=None, clean_text=None, blocks_json="[]", keywords_json="[]", quality_flags_json=j(["legacy_unverified"]),
            content_status="unknown", status="legacy_unverified", created_at=legacy_utc(feature["analyzed_at"]),
            completed_at=None, error_code=None))
        feature_id = stable("article_features", article_id)
        put(target, "article_features", dict(id=feature_id, article_id=article_id,
            prepared_article_id=prepared_id, feature_group="legacy_unclassified",
            analysis_input_hash=input_hash, analysis_config_hash=digest("legacy unknown"),
            analyzer_version=feature["algorithm_version"], skill_version="legacy_unknown",
            reused_from_feature_id=None, model_id=None, prompt_version=None,
            features_json=feature["features_json"], evidence_json="{}", uncertainty_json="{}",
            status="legacy_unverified", created_at=legacy_utc(feature["analyzed_at"]), completed_at=None))
        mapped(target, "article_features", article_id, "article_features", feature_id, digest(j(feature)))

    profiles = {r["id"]: r for r in cache.get("style_profiles", [])}
    profile_members = {}
    for link in cache.get("style_profile_articles", []):
        profile_members.setdefault(link["profile_id"], []).append(link)
    for profile in profiles.values():
        pid = profile["id"]
        collection_id = stable("article_collections", pid)
        snapshot_id = stable("article_collection_snapshots", pid)
        version_id = stable("style_profile_versions", pid)
        created = legacy_utc(profile["created_at"])
        for member in profile_members.get(pid, []):
            if member["sample_id"] not in sample_ids:
                report["warnings"].append(f"orphan profile member {pid}/{member['sample_id']}; preserved in archive")
        members = [member for member in profile_members.get(pid, []) if member["sample_id"] in sample_ids]
        put(target, "article_collections", dict(id=collection_id, name=f"Legacy profile {pid}", filter_json="{}",
            selection_mode="frozen", version=1, row_version=1, created_at=created, updated_at=created))
        put(target, "article_collection_snapshots", dict(id=snapshot_id, collection_id=collection_id,
            version_number=1, collection_version=1, filter_json="{}", sampling_config_json=j({"legacy": True}),
            random_seed=None, candidate_count=len(members), included_count=len(members), excluded_count=0,
            frozen_at=None, status="selection_building", sealed_at=None, row_version=1))
        for member in members:
            item_id = stable("snapshot_item", f"{pid}:{member['sample_id']}")
            put(target, "article_collection_snapshot_items", dict(id=item_id,
                snapshot_id=snapshot_id, article_id=member["sample_id"],
                article_revision_id=stable("article_revisions", member["sample_id"]),
                prepared_article_id=None, stratum_json="{}", included=1, exclusion_reason=None))
            mapped(target, "style_profile_articles", f"{pid}:{member['sample_id']}",
                "article_collection_snapshot_items", item_id, digest(j(member)))
        target.execute("UPDATE article_collection_snapshots SET status='selection_frozen', frozen_at=? WHERE id=?", (created, snapshot_id))
        put(target, "style_profiles", dict(id=pid, name=f"Legacy profile {pid}", platform_id=profile["platform_id"],
            genre_id=None, current_version_id=version_id, created_at=created, updated_at=created))
        put(target, "style_profile_versions", dict(id=version_id, profile_id=pid, version_number=profile["version"],
            collection_snapshot_id=snapshot_id, profile_json=profile["profile_json"],
            sample_count=profile["sample_count"], valid_sample_count=0,
            exclusion_reasons_json=j({"legacy_unverified": profile["sample_count"]}),
            sample_distribution_json="{}", outlier_method_json="{}", evidence_coverage_json="{}",
            uncertainty_json=j({"legacy_unverified": True}), analyzer_version=profile["method"],
            status="legacy_unverified", reviewer_note=None, reviewed_at=None, created_at=created))
        mapped(target, "style_profiles", pid, "style_profiles", pid, digest(j(profile)))

    strategies = {r["id"]: r for r in cache.get("content_strategies", [])}
    # 2026-10-24：本次修改原因：旧策略已删除但引用行尚存时建立明确的孤儿占位版本，保留引用而不伪造策略规则。
    task_requests = {task["id"]: decode(task["request_json"], {}) for task in cache.get("tasks", [])}
    requested_strategy_ids = {request.get("strategy_id") for request in task_requests.values()
                              if isinstance(request, dict) and request.get("strategy_id")}
    orphan_strategy_ids = ({r["strategy_id"] for r in cache.get("content_strategy_references", [])}
                           | requested_strategy_ids) - set(strategies)
    for sid in sorted(orphan_strategy_ids):
        version_id = stable("content_strategy_versions", sid)
        created = stamp()
        put(target, "content_strategies", dict(id=sid, name=f"Legacy missing strategy {sid}",
            platform_id=None, category_id=None, content_format_id=None, audience_id=None,
            genre_id=None, current_version_id=version_id, created_at=created, updated_at=created))
        put(target, "content_strategy_versions", dict(id=version_id, strategy_id=sid,
            version_number=1, style_profile_version_id=None, performance_analysis_id=None,
            rules_json="{}", source_snapshot_json=j({"legacy_strategy_missing": True}),
            skill_version=None, prompt_version=None, status="legacy_orphaned", reviewer_note=None,
            published_at=None, created_at=created))
        report["warnings"].append(f"strategy {sid} missing; created explicit orphan placeholder")
    for strategy in strategies.values():
        sid = strategy["id"]
        version_id = stable("content_strategy_versions", sid)
        created = legacy_utc(strategy["created_at"])
        put(target, "content_strategies", dict(id=sid, name=strategy["title"], platform_id=strategy["platform_id"],
            category_id=strategy["category_id"], content_format_id=strategy["format_id"],
            audience_id=None, genre_id=None, current_version_id=version_id, created_at=created, updated_at=created))
        put(target, "content_strategy_versions", dict(id=version_id, strategy_id=sid,
            version_number=strategy["version"], style_profile_version_id=None, performance_analysis_id=None,
            rules_json=strategy["guide_json"], source_snapshot_json=j(strategy), skill_version=None,
            prompt_version=None, status="legacy_unverified", reviewer_note=None, published_at=None, created_at=created))
        sample_refs = decode(strategy["sample_ids_json"], [])
        if isinstance(sample_refs, list):
            for index, article_id in enumerate(sample_refs):
                article_id = str(article_id)
                put(target, "strategy_article_refs", dict(id=stable("strategy_article_refs", f"{sid}:{index}"),
                    strategy_version_id=version_id, article_id=article_id if article_id in sample_ids else None,
                    legacy_article_id=None if article_id in sample_ids else str(article_id),
                    title_snapshot=sample_titles.get(article_id, "Legacy sample title unavailable"),
                    url_snapshot=None, source_provider="legacy"))
        mapped(target, "content_strategies", sid, "content_strategies", sid, digest(j(strategy)))
    for ref in cache.get("content_strategy_references", []):
        sid = ref["strategy_id"]
        if sid not in strategies and sid not in orphan_strategy_ids:
            report["warnings"].append(f"orphan strategy reference {ref['id']}")
            continue
        put(target, "strategy_article_refs", dict(id=ref["id"],
            strategy_version_id=stable("content_strategy_versions", sid), article_id=None,
            legacy_article_id=None, title_snapshot=ref["title"], url_snapshot=ref["source_url"],
            source_provider=ref["provider"]))
        mapped(target, "content_strategy_references", ref["id"], "strategy_article_refs", ref["id"], digest(j(ref)))
    for link in cache.get("strategy_profile_links", []):
        if link["strategy_id"] in strategies and link["profile_id"] in profiles:
            target.execute("UPDATE content_strategy_versions SET style_profile_version_id=? WHERE id=?",
                (stable("style_profile_versions", link["profile_id"]), stable("content_strategy_versions", link["strategy_id"])))
            mapped(target, "strategy_profile_links", f"{link['strategy_id']}:{link['profile_id']}",
                "content_strategy_versions", stable("content_strategy_versions", link["strategy_id"]), digest(j(link)))
        else:
            report["warnings"].append(f"orphan strategy/profile link {link['strategy_id']}/{link['profile_id']}; preserved in archive")

    strategy_version_ids = {(sid, row["version"]): stable("content_strategy_versions", sid)
                            for sid, row in strategies.items()}
    strategy_version_ids.update({(sid, 1): stable("content_strategy_versions", sid) for sid in orphan_strategy_ids})
    for request in task_requests.values():
        if not isinstance(request, dict) or not request.get("strategy_id"):
            continue
        sid = request["strategy_id"]
        requested_version = request.get("strategy_version")
        if not isinstance(requested_version, int) or requested_version < 1:
            continue
        key = (sid, requested_version)
        if key in strategy_version_ids:
            continue
        version_id = stable("content_strategy_versions", f"{sid}:task:{requested_version}")
        put(target, "content_strategy_versions", dict(id=version_id, strategy_id=sid,
            version_number=requested_version, style_profile_version_id=None, performance_analysis_id=None,
            rules_json=j(request.get("strategy_guide")), source_snapshot_json=j({"legacy_task_request": request}),
            skill_version=None, prompt_version=None, status="legacy_unverified", reviewer_note=None,
            published_at=None, created_at=stamp()))
        strategy_version_ids[key] = version_id

    results = {r["task_id"]: r for r in cache.get("task_results", [])}
    drafts = {r["task_id"]: r for r in cache.get("task_drafts", [])}
    for task in cache.get("tasks", []):
        tid = task["id"]
        request = task_requests[tid]
        if not isinstance(request, dict):
            request = {}
        put(target, "processing_jobs", dict(id=tid, job_type="legacy_generation", target_type="generated_document",
            target_id=stable("generated_documents", tid), status="legacy_unverified", progress=0,
            attempt_count=0, max_attempts=1, idempotency_key=None, input_hash=digest(task["request_json"]),
            config_hash=digest("legacy unknown"), input_versions_json="{}", input_json=task["request_json"],
            result_json=None, lease_owner=None, lease_until=None, heartbeat_at=None, row_version=1,
            error_code=None, error_message=results.get(tid, {}).get("error"),
            created_at=legacy_utc(task["created_at"]), started_at=None, completed_at=None))
        if tid in results or tid in drafts:
            doc_id = stable("generated_documents", tid)
            strategy_key = (request.get("strategy_id"), request.get("strategy_version"))
            strategy_version_id = strategy_version_ids.get(strategy_key)
            if strategy_version_id is None and request.get("strategy_id"):
                sid = request["strategy_id"]
                strategy_version_id = stable("content_strategy_versions", sid)
                report["warnings"].append(f"task {tid} strategy version missing; linked unverified current placeholder")
            brand_id = request.get("brand_id")
            brands = {row["id"] for row in cache.get("brands", [])}
            if brand_id not in brands:
                brand_id = None
            put(target, "generated_documents", dict(id=doc_id, generation_job_id=tid,
                strategy_version_id=strategy_version_id, brand_id=brand_id, brand_version=request.get("brand_version"),
                target_platform_id=str(request.get("platform_id") or "unknown"),
                topic=str(request.get("topic") or "Legacy generation"), audience_id=request.get("audience_id"),
                requirements_json=task["request_json"],
                strategy_snapshot_json=j({"legacy_strategy_id": request.get("strategy_id"),
                    "legacy_strategy_version": request.get("strategy_version"),
                    "strategy_guide": request.get("strategy_guide")}),
                brand_snapshot_json=j({"legacy_brand_id": request.get("brand_id"),
                    "legacy_brand_version": request.get("brand_version")}),
                created_at=legacy_utc(task["created_at"])))
            for number, (origin, item) in enumerate((("legacy_result", results.get(tid)), ("legacy_draft", drafts.get(tid))), 1):
                if item is None:
                    continue
                revision_no = 1 if origin == "legacy_result" else (2 if tid in results else 1)
                generated_revision_id = stable("generated_revisions", f"{tid}:{origin}")
                put(target, "generated_revisions", dict(id=generated_revision_id,
                    document_id=doc_id, revision_number=revision_no, origin=origin,
                    title=item.get("title") or "Legacy untitled", summary=item.get("summary"),
                    body_markdown=item.get("body_markdown") or "", provider=item.get("provider"),
                    model_id=item.get("model"), prompt_version=None, input_tokens=item.get("input_tokens"),
                    output_tokens=item.get("output_tokens"),
                    created_at=legacy_utc(item.get("completed_at") or item.get("updated_at") or task["created_at"])))
                mapped(target, "task_results" if origin == "legacy_result" else "task_drafts",
                    tid, "generated_revisions", generated_revision_id, digest(j(item)))
            mapped(target, "tasks", tid, "generated_documents", doc_id, digest(j(task)))
        else:
            mapped(target, "tasks", tid, "processing_jobs", tid, digest(j(task)))

    for run in cache.get("article_analysis_runs", []):
        put(target, "processing_jobs", dict(id=run["id"], job_type="legacy_analysis", target_type="legacy_scope",
            target_id=None, status="legacy_unverified", progress=0, attempt_count=0, max_attempts=1,
            idempotency_key=None, input_hash=digest(run["scope_json"]), config_hash=digest("legacy unknown"),
            input_versions_json="{}", input_json=run["scope_json"], result_json=None, lease_owner=None,
            lease_until=None, heartbeat_at=None, row_version=1, error_code=None, error_message=run["error"],
            created_at=legacy_utc(run["created_at"]), started_at=None, completed_at=legacy_utc(run["completed_at"])))
        mapped(target, "article_analysis_runs", run["id"], "processing_jobs", run["id"], digest(j(run)))

    drafts_old = cache.get("candidate_drafts", [])
    if drafts_old:
        session_id = stable("discovery_sessions", "legacy_drafts")
        fetch_id = stable("discovery_fetches", "legacy_drafts")
        put(target, "discovery_sessions", dict(id=session_id, platform_id="unknown", provider="legacy",
            endpoint="legacy_draft", request_params_json="{}", status="legacy_unverified",
            result_count=len(drafts_old), pinned=1, created_at=stamp(), expires_at="9999-12-31T00:00:00+00:00",
            last_viewed_at=None))
        put(target, "discovery_fetches", dict(id=fetch_id, session_id=session_id, request_params_json="{}",
            raw_response_json="{}", upstream_cursor=None, result_count=len(drafts_old), has_more=None, fetched_at=stamp()))
        for draft in drafts_old:
            cid = stable("discovery_candidates", draft["candidate_key"])
            put(target, "discovery_candidates", dict(id=cid, session_id=session_id, fetch_id=fetch_id,
                candidate_kind="legacy_draft", provider="legacy", endpoint="legacy_draft", external_id=None,
                candidate_key=draft["candidate_key"], raw_item_json="{}", normalized_json=draft["value_json"],
                field_provenance_json="{}", edit_draft_json=draft["value_json"], row_version=1,
                parser_version="legacy_unverified", warnings_json=j(["Legacy draft source unverified"]),
                content_status="unknown", pinned=1, collected_article_id=None,
                discovered_at=legacy_utc(draft["updated_at"]), updated_at=legacy_utc(draft["updated_at"])))
            mapped(target, "candidate_drafts", draft["candidate_key"], "discovery_candidates", cid, digest(j(draft)))

    for name in cache:
        report["archived_counts"][name] = target.execute(
            "SELECT COUNT(*) FROM legacy_payload_archive WHERE legacy_table=?", (name,)).fetchone()[0]
        if report["archived_counts"][name] != report["source_counts"][name]:
            report["archive_mismatches"].append(name)
        active_count = target.execute("SELECT COUNT(DISTINCT legacy_id) FROM legacy_id_map "
            "WHERE legacy_table=? AND target_table!='legacy_payload_archive'", (name,)).fetchone()[0]
        report["active_mapping_counts"][name] = active_count
        if active_count < report["source_counts"][name]:
            report["active_mapping_gaps"][name] = report["source_counts"][name] - active_count
    # 2026-10-24：本次修改原因：用数据库回读值而非内存临时值核对正文与生成稿的逐条 Hash。
    for sample in cache["content_samples"]:
        article_body = target.execute("SELECT body_text FROM articles WHERE id=?", (sample["id"],)).fetchone()
        revision_body = target.execute("SELECT body_text FROM article_revisions WHERE article_id=? AND revision_number=1",
            (sample["id"],)).fetchone()
        if article_body is None or revision_body is None or digest(article_body[0]) != digest(sample["body_text"]) or digest(revision_body[0]) != digest(sample["body_text"]):
            report["hash_mismatches"].append(f"content_samples:{sample['id']}")
    for old_table, origin in (("task_results", "legacy_result"), ("task_drafts", "legacy_draft")):
        for row in cache.get(old_table, []):
            revised = target.execute("SELECT body_markdown FROM generated_revisions WHERE id=?",
                (stable("generated_revisions", f"{row['task_id']}:{origin}"),)).fetchone()
            if revised is None or digest(revised[0]) != digest(row.get("body_markdown") or ""):
                report["hash_mismatches"].append(f"{old_table}:{row['task_id']}")
    target_tables = [row[0] for row in target.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    report["target_entity_counts"] = {name: target.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
                                      for name in target_tables}
    report["foreign_key_errors"] = [list(row) for row in target.execute("PRAGMA foreign_key_check")]
    if report["foreign_key_errors"] or report["hash_mismatches"] or report["archive_mismatches"]:
        raise RuntimeError("Migration integrity check failed; inspect rehearsal output")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=LEGACY_DEFAULT)
    parser.add_argument("--output", type=Path, required=True, help="New, nonexistent rehearsal directory")
    args = parser.parse_args()
    source_path = args.source.resolve(strict=True)
    output = args.output.resolve()
    if output.exists():
        raise SystemExit("Output directory already exists; refusing to overwrite a prior rehearsal")
    if source_path == output / "target-v2.db":
        raise SystemExit("Source and target must be different")
    output.mkdir(parents=True, exist_ok=False)
    source = sqlite3.connect(f"file:{source_path.as_posix()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    backup_path = output / "legacy-backup.db"
    with sqlite3.connect(backup_path) as backup:
        source.backup(backup)
    preflight_report = preflight(source)
    (output / "preflight-report.json").write_text(j(preflight_report), encoding="utf-8")
    if preflight_report["missing_required"]:
        raise RuntimeError("Legacy schema preflight failed; inspect preflight-report.json")
    target_path = output / "target-v2.db"
    url = f"sqlite:///{target_path.as_posix()}"
    # 2026-10-24：本次修改原因：Alembic 仅在新副本运行；子进程不继承可能指向旧库的配置 URL。
    env = dict(os.environ, AI4GEO_V2_DATABASE_URL=url)
    migration = subprocess.run([sys.executable, "-m", "alembic", "-c", str(BACKEND / "alembic.ini"),
        "-x", f"db_url={url}", "upgrade", "head"], cwd=BACKEND, env=env,
        capture_output=True, text=True, check=False)
    if migration.returncode:
        (output / "failure-report.json").write_text(j({"stage": "alembic_upgrade",
            "return_code": migration.returncode, "stderr": migration.stderr[-5000:],
            "backup_path": str(backup_path), "target_path": str(target_path)}), encoding="utf-8")
        raise RuntimeError("Target schema migration failed; inspect failure-report.json")
    # 2026-10-24：本次修改原因：版本记录缺失时在写入旧数据前中止，避免留下看似成功的未版本化目标库。
    version_check = sqlite3.connect(f"file:{target_path.as_posix()}?mode=ro", uri=True)
    try:
        revision = version_check.execute("SELECT version_num FROM alembic_version").fetchone()
        version_error = None
    except sqlite3.Error as exc:
        revision = None
        version_error = str(exc)
    finally:
        version_check.close()
    if revision is None or revision[0] != "20261024_01":
        (output / "failure-report.json").write_text(j({"stage": "alembic_version_check",
            "expected_revision": "20261024_01", "actual_revision": revision[0] if revision else None,
            "error": version_error, "target_path": str(target_path)}), encoding="utf-8")
        raise RuntimeError("Alembic revision was not recorded; inspect failure-report.json")
    target = sqlite3.connect(target_path)
    target.execute("PRAGMA foreign_keys=ON")
    target.execute("PRAGMA busy_timeout=10000")
    try:
        with target:
            report = migrate(source, target)
        report["source_path"] = str(source_path)
        report["backup_path"] = str(backup_path)
        report["target_path"] = str(target_path)
        report["alembic_revision"] = target.execute("SELECT version_num FROM alembic_version").fetchone()[0]
        (output / "migration-report.json").write_text(j(report), encoding="utf-8")
        print(f"Rehearsal complete: {output / 'migration-report.json'}")
    except Exception as exc:
        (output / "failure-report.json").write_text(j({"error_type": type(exc).__name__,
            "error": str(exc), "source_path": str(source_path), "backup_path": str(backup_path),
            "target_path": str(target_path)}), encoding="utf-8")
        raise
    finally:
        target.close()
        source.close()


if __name__ == "__main__":
    main()
