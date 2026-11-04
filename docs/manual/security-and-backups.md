# Security & encryption

## Accounts

- Username + password for every user. The first account is the administrator, who can add or remove users (**Settings → Account**).
- Passwords are hashed with **scrypt** (per-user salt).
- Signing in creates a random 256-bit session token, valid for 30 days. Only its SHA-256 hash is stored. Signing out, or “forgetting” a device in **Settings → Devices & notifications**, revokes it.
- Repeated failed logins from the same address are blocked for 10 minutes.

## Encryption at rest

Everything personal is encrypted with **Fernet** (AES-128-CBC + HMAC-SHA256) before it touches the disk:

- study titles, notes, AI output, model reasoning
- uploaded files and their extracted text
- calling/prayer conversations and summaries
- reading history notes, device names, IP addresses, user agents
- settings, including API keys and Home Assistant tokens
- cached source pages

The key lives in `secret.key` in the data folder (or the `TOLLE_MASTER_KEY` environment variable). Anyone with both the data and the key can read it – protect backups, and consider keeping the key separately.

What is **not** encrypted: usernames, timestamps, which Bible book/chapter a reading entry refers to, and record counts (needed for sorting, statistics and reminders).

## Encryption in transit

- **Home Assistant sidebar (Ingress):** uses Home Assistant's own connection – HTTPS if you reach Home Assistant over HTTPS (e.g. Nabu Casa, a reverse proxy, or the SSL add-on settings).
- **Direct port / Docker:** use a reverse proxy with HTTPS, or Tolle's built-in TLS (`/data/ssl/cert.pem` + `key.pem`). Don't expose plain HTTP to the internet.
- **Mobile apps:** connect over HTTPS outside your home network.

## Web security headers

Tolle sends a strict Content-Security-Policy (scripts only from itself plus the WebLLM CDN for on-device AI), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and no-store caching for API responses. AI output is rendered as sanitised Markdown (DOMPurify). File downloads use the auth header, never tokens in URLs.

## AI providers

Cloud AI providers receive the content of the request. Use Ollama or On-device AI for complete privacy.

## Reporting a vulnerability

Please open a private security advisory on GitHub rather than a public issue.
