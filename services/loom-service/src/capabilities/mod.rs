pub mod community;
pub mod estimate;
pub mod models;
pub mod provider_discovery;
pub mod repository;
pub mod resources;
pub mod strategy;

pub use community::{
    configured_catalog_path, default_catalog_path, load_catalog_from_path,
    CommunityBenchmarkRecord, CommunityImportSummary,
};
pub use estimate::{
    estimate_model_compatibility, CompatibilityEstimate, CompatibilityEstimateInput,
};
pub use models::{default_model_catalog_entries, ModelCatalogEntry};
pub use provider_discovery::{
    discovery_error, discovery_error_from_provider, discovery_response,
    ingest_provider_model_names, ProviderModelDiscoveryRequest, ProviderModelDiscoveryResponse,
};
pub use repository::CapabilityRepository;
pub use resources::{detect_system_resources, SystemResourceSnapshot};
pub use strategy::{
    resolve_execution_strategy, resolve_execution_strategy_with_community_entries,
    ExecutionStrategyDecision, ResolveExecutionStrategyInput,
};
