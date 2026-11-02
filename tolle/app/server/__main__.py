"""Entry point: python -m server

Optional built-in HTTPS for Docker / direct-port use: put cert.pem and key.pem
in <data>/ssl/ or set TOLLE_SSL_CERT and TOLLE_SSL_KEY.
"""
import os

import uvicorn

from .config import DATA_DIR, PORT


def main() -> None:
    cert = os.environ.get("TOLLE_SSL_CERT") or str(DATA_DIR / "ssl" / "cert.pem")
    key = os.environ.get("TOLLE_SSL_KEY") or str(DATA_DIR / "ssl" / "key.pem")
    tls = os.path.exists(cert) and os.path.exists(key)
    print(f"Tolle starting on port {PORT} ({'HTTPS' if tls else 'HTTP'}) – data in {DATA_DIR}", flush=True)
    uvicorn.run(
        "server.main:app",
        host="0.0.0.0",
        port=PORT,
        proxy_headers=True,
        forwarded_allow_ips="*",
        ssl_certfile=cert if tls else None,
        ssl_keyfile=key if tls else None,
        log_level=os.environ.get("TOLLE_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
