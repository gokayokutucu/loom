# Test Plan: PROVIDER-ROUTING-001 (v1.0)

Verification of provider routing path:

- [x] Test Case 1: SendMessageInput carries `providerProfileId`
  - Input: SendMessageInput with `providerProfileId: "litellm-sandbox"`
  - Output: Serialized HTTP JSON payload includes `"providerProfileId": "litellm-sandbox"`.

- [x] Test Case 2: Omitted when undefined
  - Input: SendMessageInput with `providerProfileId: undefined`
  - Output: Serialized HTTP JSON payload does not contain `"providerProfileId"`.

- [x] Test Case 3: Legacy model-only flow unchanged
  - Input: SendMessageInput with `model` only
  - Output: Serializes model correctly, no warnings, no profile field sent.

- [x] Test Case 4: Rust deserialization compat
  - Input: Backend receives JSON execute payload with `"providerProfileId": "litellm-sandbox"`
  - Output: Deserializes into `OrchestrationExecuteInput` with `provider_profile_id` equal to `Some("litellm-sandbox")`.

- [x] Test Case 5: Rust legacy deserialization compat
  - Input: Backend receives JSON payload without `"providerProfileId"`
  - Output: Deserializes cleanly, field defaults to `None`.
