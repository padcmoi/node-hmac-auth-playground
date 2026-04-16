# node-hmac-auth playground

Playground for testing `@naskot/node-hmac-auth` with two stacks:

- Express (`/web/tests/express_api/express`)
- NestJS (`/web/tests/express_api/nestjs`)

This repo contains:

- `api_1`, `api_2`: classic peer-to-peer HMAC routes
- `api_shared_1` to `api_shared_5`: multi-API propagation + secured calls

## Important

`api_shared_*` ports are intentionally the same in both stacks.
Use only one stack at a time for shared tests.

Shared ports (Express or NestJS):

- `api_shared_1`: `3021`
- `api_shared_2`: `3022`
- `api_shared_3`: `3023`
- `api_shared_4`: `3024`
- `api_shared_5`: `3025`

Classic ports:

- `api_1`: `3001`
- `api_2`: `3002`

Redis ACL (both stacks):

- user: `user`
- password: `password`
- URL: `redis://user:password@127.0.0.1:6379`

## Branch under test

Shared APIs are configured to use the library from:

- `feature/http-internal-key-propagation`

They do not use npm registry for this path.
They install the branch tarball and run a postinstall build to ensure `dist/` exists.

## Folder layout

- `express/docker-compose.yml`
- `express/api_1`, `express/api_2`
- `express/api_shared_1` ... `express/api_shared_5`
- `nestjs/docker-compose.yml`
- `nestjs/api_1`, `nestjs/api_2`
- `nestjs/api_shared_1` ... `nestjs/api_shared_5`

## Start Express stack

```bash
cd /web/tests/express_api/express
docker compose up -d
```

For shared-only tests:

```bash
cd /web/tests/express_api/express
docker compose up -d redis api_shared_1 api_shared_2 api_shared_3 api_shared_4 api_shared_5
```

## Start NestJS stack

```bash
cd /web/tests/express_api/nestjs
docker compose up -d
```

For shared-only tests:

```bash
cd /web/tests/express_api/nestjs
docker compose up -d redis api_shared_1 api_shared_2 api_shared_3 api_shared_4 api_shared_5
```

## Shared API routes

Each `api_shared_*` exposes:

- `GET /public/call-shared-get?keyId=<clientId>&q=<message>`
- `GET /public/propagate-client?operation=<create|update|delete|health>&clientId=<id>&target=<url>[&target=<url>...]&secret=<plainSecret optional>&secretHash=<hash optional>&useClientId=<signerClientId optional>`
- `POST /secure/shared-post` (HMAC required)
- Internal management route (enabled): `/api/internal/hmac`

## End-to-end test flow (shared)

The same flow works on Express and NestJS.
Use `3021` (api_shared_1) as entrypoint.

1) Before any key exists locally:

```bash
curl -s "http://127.0.0.1:3021/public/call-shared-get?keyId=sharedClientAbC&q=123" | jq
```

Expected: fail (`local client not found`).

2) Bootstrap first local key on `api_shared_1`:

```bash
curl -s -X POST "http://127.0.0.1:3021/api/internal/hmac" \
  -H "content-type: application/json" \
  -d '{"clientId":"sharedClientAbC","secret":"superSharedSecret"}' | jq
```

Expected: `201` create on local API.

3) Call peers before propagation:

```bash
curl -s "http://127.0.0.1:3021/public/call-shared-get?keyId=sharedClientAbC&q=123" | jq
```

Expected: peer failures (`401 UNKNOWN_CLIENT`).

4) Propagate client to the 4 peer APIs (create with custom secret):

```bash
curl -s "http://127.0.0.1:3021/public/propagate-client?operation=create&clientId=sharedClientAbC&secret=superSharedSecret&useClientId=sharedClientAbC&target=http://api_shared_2:3022&target=http://api_shared_3:3023&target=http://api_shared_4:3024&target=http://api_shared_5:3025" | jq
```

Or create with auto-generated secret (no `secret`, hash is generated locally then propagated):

```bash
curl -s "http://127.0.0.1:3021/public/propagate-client?operation=create&clientId=sharedClientAbC&useClientId=sharedClientAbC&target=http://api_shared_2:3022&target=http://api_shared_3:3023&target=http://api_shared_4:3024&target=http://api_shared_5:3025" | jq
```

Expected: `accepted: 4`, each peer `status: 201`, and `propagatedSecretHash` in response.

5) Call peers after propagation:

```bash
curl -s "http://127.0.0.1:3021/public/call-shared-get?keyId=sharedClientAbC&q=123" | jq
```

Expected: success on all 4 peers with authenticated HMAC requests.

## Classic api_1/api_2 quick checks

```bash
curl -s http://127.0.0.1:3001/public/ping | jq
curl -s http://127.0.0.1:3002/public/ping | jq
curl -s http://127.0.0.1:3001/public/call-peer-get | jq
curl -s -X POST http://127.0.0.1:3001/public/call-peer-post -H "content-type: application/json" -d '{"hello":"world"}' | jq
```
