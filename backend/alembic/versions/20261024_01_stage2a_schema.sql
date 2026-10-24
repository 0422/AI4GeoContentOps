-- 2026-10-24：本次修改原因：将 Stage 2A 目标表、约束和索引冻结为首个版本化迁移。
CREATE TABLE content_options (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL,
  active INTEGER NOT NULL, position INTEGER NOT NULL
);
CREATE TABLE brands (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
  facts_json TEXT NOT NULL, active INTEGER NOT NULL,
  version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE llm_settings (
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL
);
CREATE TABLE discovery_sessions (
  id TEXT PRIMARY KEY, platform_id TEXT NOT NULL, provider TEXT NOT NULL,
  endpoint TEXT NOT NULL, request_params_json TEXT NOT NULL,
  status TEXT NOT NULL, result_count INTEGER, pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_viewed_at TEXT
);
CREATE TABLE articles (
  id TEXT PRIMARY KEY, platform_id TEXT NOT NULL, category_id TEXT,
  content_format_id TEXT, genre_id TEXT, audience_id TEXT,
  topic TEXT, tags_json TEXT NOT NULL,
  title TEXT NOT NULL, summary TEXT, body_text TEXT, author_name TEXT,
  published_at TEXT, article_url TEXT, canonical_url TEXT,
  review_status TEXT NOT NULL, content_status TEXT NOT NULL,
  rights_status TEXT NOT NULL, rights_scope_json TEXT NOT NULL,
  rights_evidence TEXT, quality_score INTEGER, current_revision_no INTEGER NOT NULL, current_revision_id TEXT,
  field_provenance_json TEXT NOT NULL, row_version INTEGER NOT NULL DEFAULT 1,
  collected_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(id, current_revision_id) REFERENCES article_revisions(article_id, id)
);
CREATE TABLE discovery_fetches (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES discovery_sessions(id),
  request_params_json TEXT NOT NULL, raw_response_json TEXT NOT NULL,
  upstream_cursor TEXT, result_count INTEGER, has_more INTEGER,
  fetched_at TEXT NOT NULL
);
CREATE TABLE discovery_candidates (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES discovery_sessions(id),
  fetch_id TEXT NOT NULL REFERENCES discovery_fetches(id),
  candidate_kind TEXT NOT NULL, provider TEXT NOT NULL,
  endpoint TEXT NOT NULL, external_id TEXT,
  candidate_key TEXT NOT NULL, raw_item_json TEXT NOT NULL,
  normalized_json TEXT NOT NULL, field_provenance_json TEXT NOT NULL,
  edit_draft_json TEXT, row_version INTEGER NOT NULL DEFAULT 1,
  parser_version TEXT NOT NULL, warnings_json TEXT NOT NULL,
  content_status TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  collected_article_id TEXT REFERENCES articles(id),
  discovered_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(session_id, candidate_key)
);
CREATE TABLE article_sources (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id),
  discovery_candidate_id TEXT REFERENCES discovery_candidates(id) ON DELETE SET NULL,
  acquisition_method TEXT NOT NULL, provider TEXT NOT NULL, endpoint TEXT,
  external_id TEXT, source_url TEXT, source_category TEXT,
  request_params_json TEXT NOT NULL, response_meta_json TEXT NOT NULL,
  field_mapping_json TEXT NOT NULL, raw_item_hash TEXT,
  raw_content_hash TEXT, content_format TEXT NOT NULL,
  raw_complete INTEGER NOT NULL, parser_version TEXT NOT NULL,
  warnings_json TEXT NOT NULL, fetched_at TEXT NOT NULL
);
CREATE TABLE article_source_payloads (
  source_id TEXT PRIMARY KEY REFERENCES article_sources(id),
  raw_item_json TEXT NOT NULL, raw_content TEXT,
  stored_at TEXT NOT NULL, retain_until TEXT
);
CREATE TABLE rights_decisions (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id),
  source_id TEXT REFERENCES article_sources(id), status TEXT NOT NULL,
  scope_json TEXT NOT NULL, evidence TEXT, policy_version TEXT NOT NULL,
  supersedes_id TEXT REFERENCES rights_decisions(id),
  effective_at TEXT NOT NULL, expires_at TEXT, recorded_at TEXT NOT NULL
);
CREATE TABLE article_metrics (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id),
  source_id TEXT REFERENCES article_sources(id), source_label TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  read_raw TEXT, read_exact INTEGER, read_lower_bound INTEGER,
  likes INTEGER, watch_count INTEGER, comments INTEGER, shares INTEGER,
  saves INTEGER, rewards INTEGER, fans_count INTEGER, interactive_count INTEGER,
  impressions INTEGER, clicks INTEGER, extra_metrics_json TEXT NOT NULL,
  parse_warnings_json TEXT NOT NULL, field_provenance_json TEXT NOT NULL
);
CREATE TABLE article_revisions (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id),
  revision_number INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT,
  body_text TEXT, author_name TEXT, published_at TEXT,
  category_id TEXT, content_format_id TEXT, genre_id TEXT, article_url TEXT,
  snapshot_json TEXT NOT NULL, field_provenance_json TEXT NOT NULL,
  edited_fields_json TEXT NOT NULL, editor_note TEXT,
  created_at TEXT NOT NULL, UNIQUE(article_id, revision_number),
  UNIQUE(article_id, id)
);
CREATE TABLE prepared_articles (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id),
  article_revision_id TEXT REFERENCES article_revisions(id),
  source_id TEXT REFERENCES article_sources(id), input_origin TEXT NOT NULL,
  input_ref_id TEXT NOT NULL, input_format TEXT NOT NULL,
  input_hash TEXT NOT NULL, content_hash TEXT NOT NULL,
  preparation_config_hash TEXT NOT NULL,
  cleaner_version TEXT NOT NULL,
  reused_from_prepared_id TEXT REFERENCES prepared_articles(id),
  clean_title TEXT, clean_text TEXT, blocks_json TEXT NOT NULL,
  keywords_json TEXT NOT NULL, quality_flags_json TEXT NOT NULL,
  content_status TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, completed_at TEXT, error_code TEXT,
  UNIQUE(article_id, input_origin, input_ref_id, input_hash,
         preparation_config_hash, cleaner_version)
);
CREATE TABLE article_features (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id),
  prepared_article_id TEXT NOT NULL REFERENCES prepared_articles(id),
  feature_group TEXT NOT NULL, analysis_input_hash TEXT NOT NULL,
  analysis_config_hash TEXT NOT NULL,
  analyzer_version TEXT NOT NULL, skill_version TEXT NOT NULL,
  reused_from_feature_id TEXT REFERENCES article_features(id),
  model_id TEXT, prompt_version TEXT, features_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL, uncertainty_json TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
  UNIQUE(prepared_article_id, feature_group, analysis_input_hash,
         analysis_config_hash, analyzer_version)
);
CREATE TABLE article_collections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, filter_json TEXT NOT NULL,
  selection_mode TEXT NOT NULL, version INTEGER NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE article_collection_items (
  collection_id TEXT NOT NULL REFERENCES article_collections(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  added_at TEXT NOT NULL, PRIMARY KEY(collection_id, article_id)
);
CREATE TABLE article_collection_snapshots (
  id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES article_collections(id),
  version_number INTEGER NOT NULL, collection_version INTEGER NOT NULL,
  filter_json TEXT NOT NULL, sampling_config_json TEXT NOT NULL,
  random_seed TEXT, candidate_count INTEGER NOT NULL,
  included_count INTEGER NOT NULL, excluded_count INTEGER NOT NULL,
  frozen_at TEXT, status TEXT NOT NULL DEFAULT 'selection_building',
  sealed_at TEXT, row_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(collection_id, version_number)
);
CREATE TABLE article_collection_snapshot_items (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES article_collection_snapshots(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  article_revision_id TEXT REFERENCES article_revisions(id),
  prepared_article_id TEXT REFERENCES prepared_articles(id),
  stratum_json TEXT NOT NULL, included INTEGER NOT NULL,
  exclusion_reason TEXT, UNIQUE(snapshot_id, article_id)
);
CREATE TABLE article_collection_snapshot_features (
  snapshot_item_id TEXT NOT NULL REFERENCES article_collection_snapshot_items(id),
  feature_id TEXT NOT NULL REFERENCES article_features(id),
  PRIMARY KEY(snapshot_item_id, feature_id)
);
CREATE TABLE style_profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, platform_id TEXT,
  genre_id TEXT, current_version_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE style_profile_versions (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES style_profiles(id),
  version_number INTEGER NOT NULL,
  collection_snapshot_id TEXT NOT NULL REFERENCES article_collection_snapshots(id),
  profile_json TEXT NOT NULL, sample_count INTEGER NOT NULL,
  valid_sample_count INTEGER NOT NULL, exclusion_reasons_json TEXT NOT NULL,
  sample_distribution_json TEXT NOT NULL, outlier_method_json TEXT NOT NULL,
  evidence_coverage_json TEXT NOT NULL, uncertainty_json TEXT NOT NULL,
  analyzer_version TEXT NOT NULL, status TEXT NOT NULL,
  reviewer_note TEXT, reviewed_at TEXT, created_at TEXT NOT NULL,
  UNIQUE(profile_id, version_number)
);
CREATE TABLE style_profile_inputs (
  profile_version_id TEXT NOT NULL REFERENCES style_profile_versions(id),
  snapshot_item_id TEXT NOT NULL REFERENCES article_collection_snapshot_items(id),
  feature_id TEXT NOT NULL REFERENCES article_features(id),
  PRIMARY KEY(profile_version_id, feature_id)
);
CREATE TABLE performance_analyses (
  id TEXT PRIMARY KEY,
  collection_snapshot_id TEXT NOT NULL REFERENCES article_collection_snapshots(id),
  analysis_config_hash TEXT NOT NULL, method_version TEXT NOT NULL,
  result_json TEXT NOT NULL, valid_sample_count INTEGER NOT NULL,
  missing_count INTEGER NOT NULL, censored_count INTEGER NOT NULL,
  exclusion_reasons_json TEXT NOT NULL, status TEXT NOT NULL,
  reviewer_note TEXT, reviewed_at TEXT, created_at TEXT NOT NULL,
  UNIQUE(collection_snapshot_id, analysis_config_hash, method_version)
);
CREATE TABLE performance_analysis_samples (
  analysis_id TEXT NOT NULL REFERENCES performance_analyses(id),
  snapshot_item_id TEXT NOT NULL REFERENCES article_collection_snapshot_items(id),
  metric_id TEXT REFERENCES article_metrics(id),
  value_semantics TEXT NOT NULL, group_json TEXT NOT NULL,
  inclusion_reason TEXT, exclusion_reason TEXT,
  PRIMARY KEY(analysis_id, snapshot_item_id)
);
CREATE TABLE content_strategies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, platform_id TEXT,
  category_id TEXT, content_format_id TEXT, audience_id TEXT, genre_id TEXT,
  current_version_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE content_strategy_versions (
  id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL REFERENCES content_strategies(id),
  version_number INTEGER NOT NULL,
  style_profile_version_id TEXT REFERENCES style_profile_versions(id),
  performance_analysis_id TEXT REFERENCES performance_analyses(id),
  rules_json TEXT NOT NULL, source_snapshot_json TEXT NOT NULL,
  skill_version TEXT, prompt_version TEXT,
  status TEXT NOT NULL, reviewer_note TEXT, published_at TEXT,
  created_at TEXT NOT NULL, UNIQUE(strategy_id, version_number)
);
CREATE TABLE strategy_article_refs (
  id TEXT PRIMARY KEY,
  strategy_version_id TEXT NOT NULL REFERENCES content_strategy_versions(id),
  article_id TEXT REFERENCES articles(id), legacy_article_id TEXT,
  title_snapshot TEXT NOT NULL, url_snapshot TEXT,
  source_provider TEXT
);
CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY, job_type TEXT NOT NULL, target_type TEXT NOT NULL,
  target_id TEXT, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
  idempotency_key TEXT, input_hash TEXT, config_hash TEXT,
  input_versions_json TEXT NOT NULL, input_json TEXT NOT NULL,
  result_json TEXT, lease_owner TEXT, lease_until TEXT, heartbeat_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  error_code TEXT, error_message TEXT, created_at TEXT NOT NULL,
  started_at TEXT, completed_at TEXT
);
CREATE TABLE generated_documents (
  id TEXT PRIMARY KEY, generation_job_id TEXT REFERENCES processing_jobs(id),
  strategy_version_id TEXT REFERENCES content_strategy_versions(id),
  brand_id TEXT REFERENCES brands(id), brand_version INTEGER, target_platform_id TEXT NOT NULL,
  topic TEXT NOT NULL, audience_id TEXT, requirements_json TEXT NOT NULL,
  strategy_snapshot_json TEXT NOT NULL, brand_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE generated_revisions (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES generated_documents(id),
  revision_number INTEGER NOT NULL, origin TEXT NOT NULL,
  title TEXT NOT NULL, summary TEXT, body_markdown TEXT NOT NULL,
  provider TEXT, model_id TEXT, prompt_version TEXT,
  input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL,
  UNIQUE(document_id, revision_number)
);
CREATE TABLE evaluation_runs (
  id TEXT PRIMARY KEY, generated_revision_id TEXT NOT NULL REFERENCES generated_revisions(id),
  profile_version_id TEXT REFERENCES style_profile_versions(id),
  evaluator_version TEXT NOT NULL, dimensions_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL, uncertainty_json TEXT NOT NULL,
  human_decision TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE legacy_id_map (
  legacy_table TEXT NOT NULL, legacy_id TEXT NOT NULL,
  target_table TEXT NOT NULL, target_id TEXT NOT NULL,
  migrated_at TEXT NOT NULL, checksum TEXT NOT NULL,
  PRIMARY KEY(legacy_table, legacy_id, target_table)
);
CREATE TABLE legacy_payload_archive (
  legacy_table TEXT NOT NULL, legacy_id TEXT NOT NULL,
  payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
  migration_status TEXT NOT NULL, archived_at TEXT NOT NULL,
  retain_until TEXT, redacted_at TEXT,
  PRIMARY KEY(legacy_table, legacy_id)
);
CREATE TABLE data_disposition_events (
  id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
  article_id TEXT REFERENCES articles(id),
  source_id TEXT REFERENCES article_sources(id), reason TEXT NOT NULL,
  scope_json TEXT NOT NULL, status TEXT NOT NULL,
  requested_at TEXT NOT NULL, completed_at TEXT, error_summary TEXT
);
CREATE INDEX ix_discovery_session_expiry ON discovery_sessions(expires_at, pinned);
CREATE INDEX ix_discovery_fetch_session ON discovery_fetches(session_id, fetched_at);
CREATE INDEX ix_candidate_collected ON discovery_candidates(collected_article_id);
CREATE UNIQUE INDEX ux_source_candidate ON article_sources(discovery_candidate_id)
  WHERE discovery_candidate_id IS NOT NULL;
CREATE INDEX ix_article_filter ON articles(platform_id, category_id, genre_id, deleted_at);
CREATE UNIQUE INDEX ux_article_canonical_url ON articles(platform_id, canonical_url)
  WHERE canonical_url IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_source_identity ON article_sources(provider, endpoint, external_id);
CREATE INDEX ix_metrics_history ON article_metrics(article_id, observed_at);
CREATE INDEX ix_rights_article ON rights_decisions(article_id, effective_at);
CREATE INDEX ix_snapshot_items ON article_collection_snapshot_items(snapshot_id, included);
CREATE INDEX ix_performance_analysis ON performance_analyses(collection_snapshot_id, status);
CREATE INDEX ix_disposition_status ON data_disposition_events(status, requested_at);
CREATE INDEX ix_strategy_article_refs ON strategy_article_refs(strategy_version_id, article_id);
CREATE INDEX ix_prepared_current ON prepared_articles(article_id, status, created_at);
CREATE INDEX ix_jobs_poll ON processing_jobs(status, lease_until, created_at);
CREATE UNIQUE INDEX ux_job_idempotency ON processing_jobs(job_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
