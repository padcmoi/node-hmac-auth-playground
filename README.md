# express_api HMAC lab

Two minimal Express + TypeScript APIs (`api_1`, `api_2`) that call each other using HMAC.
Both APIs use the same HMAC credentials by default:

- `clientId`: `clientIdAbC`
- `secret`: `superSharedSecret`

Each API keeps its own namespace by default:

- `api_1`: `hmac-lab-api1`
- `api_2`: `hmac-lab-api2`

Redis is mandatory for this library, so a Docker Compose file is included.
This lab uses Redis ACL credentials:

- user: `user`
- password: `password`
- URL: `redis://user:password@127.0.0.1:6379`

## Folder layout

- `api_1/`
- `api_2/`
- `docker-compose.yml` (Redis)

## 1) Start Redis + both APIs (Docker, nodemon auto-restart)

```bash
cd /web/tests/express_api
docker compose up -d
docker compose ps
```

Quick auth check:

```bash
docker exec -it hmac-lab-redis redis-cli --user user -a password ping
```

View live logs:

```bash
docker compose logs -f api_1 api_2
```

## 2) Install dependencies

```bash
cd /web/tests/express_api/api_1 && npm install
cd /web/tests/express_api/api_2 && npm install
```

## 3) Run both APIs

Terminal A:

```bash
cd /web/tests/express_api/api_1
npm run dev
```

Terminal B:

```bash
cd /web/tests/express_api/api_2
npm run dev
```

Default ports:

- `api_1`: `http://127.0.0.1:3001`
- `api_2`: `http://127.0.0.1:3002`

You can override HMAC credentials on both APIs (must stay identical on both sides):

```bash
HMAC_CLIENT_ID=clientIdAbC HMAC_CLIENT_SECRET=superSharedSecret npm run dev
```

## 4) Routes available on each API

Public routes:

- `GET /public/ping`
- `GET /public/call-peer-get` (public route that fetches peer secure GET route with HMAC)
- `POST /public/call-peer-post` (public route that fetches peer secure POST route with HMAC)

Secure routes (HMAC required):

- `GET /secure/get`
- `POST /secure/post`

## 5) Quick tests

### Public checks

```bash
curl -s http://127.0.0.1:3001/public/ping | jq
curl -s http://127.0.0.1:3002/public/ping | jq
```

### Test HMAC GET across APIs

```bash
curl -s http://127.0.0.1:3001/public/call-peer-get | jq
curl -s http://127.0.0.1:3002/public/call-peer-get | jq
```

### Test HMAC POST across APIs

```bash
curl -s -X POST http://127.0.0.1:3001/public/call-peer-post \
  -H "content-type: application/json" \
  -d '{"hello":"from-api1"}' | jq

curl -s -X POST http://127.0.0.1:3002/public/call-peer-post \
  -H "content-type: application/json" \
  -d '{"hello":"from-api2"}' | jq
```

If everything is correct, `upstreamStatus` should be `200` and `upstreamBody.mode` should be `secure`.
