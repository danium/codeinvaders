export type AdapterBoundary = 'sanitized-ingress' | 'capability-profile';

export {
  createOpaqueIdDeriver,
  deriveOpaqueId,
  isOpaqueId,
  opaqueIdEntityTypes,
  OpaqueIdError,
  OPAQUE_ID_KEY_BYTES,
  OPAQUE_ID_OUTPUT_BYTES,
  MAX_OPAQUE_ID_COMPONENT_CODE_UNITS,
  MAX_OPAQUE_ID_COMPONENTS,
  MAX_OPAQUE_ID_INPUT_BYTES,
} from './identity.js';
export type {
  OpaqueId,
  OpaqueIdDeriver,
  OpaqueIdEntityType,
  OpaqueIdErrorCode,
  OpaqueIdInput,
  OpaqueIdKey,
} from './identity.js';
