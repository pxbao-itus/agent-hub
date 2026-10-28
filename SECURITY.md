# Security Policy

Agent Hub is early-stage software. Please do not report security problems in
public issues.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. Include:

- what is affected (component, endpoint, version or commit),
- steps to reproduce, and
- the impact you expect.

You can expect an acknowledgement within a few days. Fixes are released on
`main`; there are no separately maintained release branches yet.

## Scope

In scope: the web app, the tRPC and MCP endpoints, authentication and access
control (organization → department → team → user), token handling, and the
`agenthub` CLI.

Out of scope: vulnerabilities in third-party dependencies with no demonstrable
impact on Agent Hub, and issues that need an already-compromised host or a
superadmin account.

## Hardening notes for self-hosters

- Generate `AUTH_SECRET` with `openssl rand -base64 32` and keep `.env` out of
  version control.
- Run behind HTTPS and set `AUTH_TRUST_HOST=true` only when a reverse proxy
  sets `x-forwarded-*` headers for you.
- The sample `docker-compose.yml` ships a development database password and is
  bound to localhost. Change it before exposing Postgres anywhere else.
- Files in `public/releases/cli` are served without authentication. Never put
  credentials there.
