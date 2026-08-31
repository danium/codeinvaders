import { canonicalizeEvent, validateEvent, type AnyCoreEvent } from '@codeinvaders/protocol';

export type IngressResult =
  | { readonly ok: true; readonly event: AnyCoreEvent }
  | { readonly ok: false; readonly code: 'invalid-ingress' | 'rejected-event' | 'native-input' };
export function canonicalizeIngress(input: unknown): IngressResult {
  if (input === null || typeof input !== 'object') return { ok: false, code: 'native-input' };
  try {
    const event = canonicalizeEvent(input);
    const checked = validateEvent(event);
    return checked.status === 'accepted'
      ? { ok: true, event: checked.event }
      : { ok: false, code: 'rejected-event' };
  } catch {
    return { ok: false, code: 'invalid-ingress' };
  }
}
