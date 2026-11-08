import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import {
  MSG_AWARENESS,
  MSG_CONTROL,
  MSG_PING,
  MSG_PONG,
  MSG_QUERY_AWARENESS,
  MSG_STATS_REQUEST,
  MSG_SYNC,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
  type ServerControlFrame,
} from './messages';

/** Frame builders used by both the server and the browser provider. */

function frame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  return frame((e) => {
    encoding.writeVarUint(e, MSG_SYNC);
    encoding.writeVarUint(e, SYNC_STEP1);
    encoding.writeVarUint8Array(e, Y.encodeStateVector(doc));
  });
}

export function encodeSyncStep2(update: Uint8Array): Uint8Array {
  return frame((e) => {
    encoding.writeVarUint(e, MSG_SYNC);
    encoding.writeVarUint(e, SYNC_STEP2);
    encoding.writeVarUint8Array(e, update);
  });
}

export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  return frame((e) => {
    encoding.writeVarUint(e, MSG_SYNC);
    encoding.writeVarUint(e, SYNC_UPDATE);
    encoding.writeVarUint8Array(e, update);
  });
}

export function encodeAwarenessFrame(update: Uint8Array): Uint8Array {
  return frame((e) => {
    encoding.writeVarUint(e, MSG_AWARENESS);
    encoding.writeVarUint8Array(e, update);
  });
}

export function encodeQueryAwareness(): Uint8Array {
  return frame((e) => {
    encoding.writeVarUint(e, MSG_QUERY_AWARENESS);
  });
}

export function encodePing(nonce: number): Uint8Array {
  return frame((e) => {
    encoding.writeVarUint(e, MSG_PING);
    encoding.writeVarUint(e, nonce);
  });
}

export function encodePong(nonce: number): Uint8Array {
  return frame((e) => {
    encoding.writeVarUint(e, MSG_PONG);
    encoding.writeVarUint(e, nonce);
  });
}

export function encodeStatsRequest(): Uint8Array {
  return frame((e) => {
    encoding.writeVarUint(e, MSG_STATS_REQUEST);
  });
}

export function encodeControlFrame(control: ServerControlFrame): Uint8Array {
  return frame((e) => {
    encoding.writeVarUint(e, MSG_CONTROL);
    encoding.writeVarString(e, JSON.stringify(control));
  });
}
