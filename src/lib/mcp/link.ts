import 'server-only'

// Her assistant link, as MYRA holds it: a hash, never the link itself.
//
// The token is signed, so it proves who she is on its own. The hash is what
// lets her SEE the link exists and TURN IT OFF — and turning it off has to work
// even though MYRA never kept a copy of what she pasted into Claude.

import crypto from 'node:crypto'

export const hashAssistantToken = (token: string): string =>
  crypto.createHash('sha256').update(String(token)).digest('hex')
