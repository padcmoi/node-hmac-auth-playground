# nestjs HMAC lab

Two minimal NestJS + TypeScript APIs (`api_1`, `api_2`) that call each other using `@naskot/node-hmac-auth`.

This reproduces the same behavior as the Express lab:

- public routes:
  - `GET /public/ping`
  - `GET /public/call-peer-get`
  - `POST /public/call-peer-post`
- secure routes (HMAC middleware):
  - `GET /secure/get`
  - `POST /secure/post`

Defaults:

- shared `clientId`: `clientIdAbC`
- shared bootstrap plain secret: `superSharedSecret`
- shared `secretToken`: `sharedHmacToken`
- namespaces:
  - api_1 => `hmac-lab-nest-api1`
  - api_2 => `hmac-lab-nest-api2`

## Start with Docker (Redis + 2 APIs + nodemon)

```bash
cd /web/tests/express_api/nestjs
docker compose up -d
docker compose ps
```

Ports:

- `api_1`: `http://127.0.0.1:3001`
- `api_2`: `http://127.0.0.1:3002`
- Redis ACL URL (host): `redis://user:password@127.0.0.1:6379`

## Quick proof commands

```bash
curl -s http://127.0.0.1:3001/public/ping | jq
curl -s http://127.0.0.1:3002/public/ping | jq

curl -s http://127.0.0.1:3001/public/call-peer-get | jq
curl -s http://127.0.0.1:3002/public/call-peer-get | jq

curl -s -X POST http://127.0.0.1:3001/public/call-peer-post \
  -H "content-type: application/json" \
  -d '{"hello":"from-nest-1"}' | jq

curl -s -X POST http://127.0.0.1:3002/public/call-peer-post \
  -H "content-type: application/json" \
  -d '{"hello":"from-nest-2"}' | jq
```

Expected behavior is identical to Express lab: upstream secure routes answer `200` when both APIs share the same credentials.
