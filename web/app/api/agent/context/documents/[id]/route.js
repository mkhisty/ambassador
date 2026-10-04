import { createContextHandlers } from '../../../../../../lib/agent-context.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createContextHandlers().document;
