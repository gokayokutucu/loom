import type { LoomEngineClient } from "./LoomEngineClient";
import { RustHttpLoomEngineClient } from "./RustHttpLoomEngineClient";
import { createTypeScriptLocalLoomEngine } from "./TypeScriptLocalLoomEngine";
import type { CreateLoomEngineClientOptions, LoomEngineMode } from "./LoomEngineTypes";
import { getElectronLoomServiceUrl } from "../electronRuntime";

const defaultServiceUrl = "/__loom";

function viteEnv() {
  return (import.meta as ImportMeta & {
    env?: {
      VITE_LOOM_ENGINE_MODE?: string;
      VITE_LOOM_ENGINE_STRICT_RUST?: string;
      VITE_LOOM_SERVICE_URL?: string;
      VITE_LOOM_SERVICE_ADDRESS_STORE_AUTHORITATIVE?: string;
      VITE_LOOM_SERVICE_GRAPH_STORE_AUTHORITATIVE?: string;
      VITE_LOOM_SERVICE_EXPORT_STORE_AUTHORITATIVE?: string;
    };
  }).env;
}

export class RustAuthoritativeModeError extends Error {
  readonly kind = "unsupported_in_rust_authoritative_mode";

  constructor(
    readonly flow: string,
    message = "This flow is not migrated to loom-service yet."
  ) {
    super(message);
    this.name = "RustAuthoritativeModeError";
  }
}

/**
 * Kept as a compatibility alias for tests and old imports. The product runtime
 * now treats rust-service as authoritative instead of toggling fallback by this flag.
 */
export const StrictRustModeError = RustAuthoritativeModeError;

export function getConfiguredLoomEngineMode(): LoomEngineMode {
  return viteEnv()?.VITE_LOOM_ENGINE_MODE === "typescript-local"
    ? "typescript-local"
    : "rust-service";
}

export function getConfiguredLoomServiceUrl() {
  return viteEnv()?.VITE_LOOM_SERVICE_URL || getElectronLoomServiceUrl() || defaultServiceUrl;
}

export function getConfiguredServiceAddressStoreAuthoritative() {
  return viteEnv()?.VITE_LOOM_SERVICE_ADDRESS_STORE_AUTHORITATIVE !== "false";
}

export function getConfiguredServiceGraphStoreAuthoritative() {
  return viteEnv()?.VITE_LOOM_SERVICE_GRAPH_STORE_AUTHORITATIVE !== "false";
}

export function getConfiguredServiceExportStoreAuthoritative() {
  return viteEnv()?.VITE_LOOM_SERVICE_EXPORT_STORE_AUTHORITATIVE !== "false";
}

export function getConfiguredStrictRustServiceMode() {
  return viteEnv()?.VITE_LOOM_ENGINE_STRICT_RUST !== "false";
}

export function createLoomEngineClient(
  options: CreateLoomEngineClientOptions = {}
): LoomEngineClient {
  const mode = options.mode ?? getConfiguredLoomEngineMode();
  if (mode === "typescript-local") {
    return createTypeScriptLocalLoomEngine(options.localDependencies);
  }
  return (
    options.rustClient ??
    new RustHttpLoomEngineClient({
      serviceUrl: options.serviceUrl ?? getConfiguredLoomServiceUrl(),
    })
  );
}
