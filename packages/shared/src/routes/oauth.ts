import { defineRoute } from '../route.js';
import { z } from '../zod.js';

// The OAuth protocol endpoints (/oauth/*, /.well-known/*) are form-encoded and live outside /v1.
// These JSON routes serve the consent UI, connected-apps management and the MCP resource server.

const tags = ['oauth'];

export const OAuthScope = z.enum(['markets:read', 'feed:read', 'portfolio:read']);

export const AuthorizeRequest = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  response_type: z.string(),
  scope: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  resource: z.string().optional(),
});

export const getOAuthClient = defineRoute({
  method: 'get',
  path: '/v1/oauth/clients/{id}',
  operationId: 'getOAuthClient',
  summary: 'Public name of a registered MCP client, for the consent screen. 404 if unknown',
  tags,
  request: { params: z.object({ id: z.string().min(1).max(200) }) },
  response: z.object({ id: z.string(), name: z.string() }),
});

export const authorizeOAuth = defineRoute({
  method: 'post',
  path: '/v1/oauth/authorize',
  operationId: 'authorizeOAuth',
  summary:
    'Record the signed-in User decision on an OAuth authorization request (same params as GET /oauth/authorize). ' +
    'Returns the URL to send the browser to: the client redirect with `code` (approve) or `error=access_denied`',
  tags,
  request: { body: AuthorizeRequest.extend({ approve: z.boolean() }) },
  response: z.object({ redirectUrl: z.string() }),
});

export const getTokenInfo = defineRoute({
  method: 'get',
  path: '/v1/oauth/token-info',
  operationId: 'getTokenInfo',
  summary:
    'Introspect the bearer token (used by the MCP resource server). 401 invalid_token when expired or revoked',
  tags,
  request: {},
  response: z.object({
    userId: z.string().uuid(),
    scopes: z.array(OAuthScope),
    /** RFC 8707 resource the token is bound to; null for web sessions and unbound tokens. */
    audience: z.string().nullable(),
    expiresAt: z.iso.datetime(),
  }),
});

export const ConnectedApp = z.object({
  id: z.string().uuid(),
  client: z.object({ id: z.string(), name: z.string() }),
  scopes: z.array(OAuthScope),
  connectedAt: z.iso.datetime(),
});
export type ConnectedApp = z.infer<typeof ConnectedApp>;

export const listConnectedApps = defineRoute({
  method: 'get',
  path: '/v1/connected-apps',
  operationId: 'listConnectedApps',
  summary: 'MCP clients (Claude, Codex, ...) the signed-in User has authorized',
  tags,
  request: {},
  response: z.object({ items: z.array(ConnectedApp) }),
});

export const revokeConnectedApp = defineRoute({
  method: 'delete',
  path: '/v1/connected-apps/{id}',
  operationId: 'revokeConnectedApp',
  summary:
    'Revoke a grant: its access and refresh tokens stop working immediately. 404 if not yours',
  tags,
  request: { params: z.object({ id: z.string().uuid() }) },
  response: z.object({ ok: z.literal(true) }),
});
