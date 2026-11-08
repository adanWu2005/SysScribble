import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/** Frames on `room:{id}:sync`: `[kind][instanceId][payload]`. */
export const BUS_UPDATE = 0 as const;
export const BUS_AWARENESS = 1 as const;
/** Payload is a state vector. Peers answer with whatever the sender is missing. */
export const BUS_STATE_VECTOR = 2 as const;

export type BusKind = typeof BUS_UPDATE | typeof BUS_AWARENESS | typeof BUS_STATE_VECTOR;

export interface BusFrame {
  kind: BusKind;
  instanceId: string;
  payload: Uint8Array;
}

export function encodeBusFrame(kind: BusKind, instanceId: string, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, kind);
  encoding.writeVarString(encoder, instanceId);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

export function decodeBusFrame(data: Uint8Array): BusFrame | null {
  try {
    const decoder = decoding.createDecoder(data);
    const kind = decoding.readVarUint(decoder);
    if (kind !== BUS_UPDATE && kind !== BUS_AWARENESS && kind !== BUS_STATE_VECTOR) return null;
    const instanceId = decoding.readVarString(decoder);
    const payload = decoding.readVarUint8Array(decoder);
    return { kind, instanceId, payload };
  } catch {
    return null;
  }
}
