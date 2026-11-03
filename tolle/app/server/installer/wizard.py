"""``tolle-server setup`` – the setup wizard for terminals (e.g. a Linux server with no screen).

It asks the same questions as the desktop app's wizard and runs the same steps.
"""
import os
import sys

from .report import Reporter, StepError

CHOICES = [
    ("personal", "Just me, on this computer"),
    ("shared", "Me on this computer and my phone or tablet"),
    ("server", "A server for several people (starts automatically, runs in the background)"),
    ("docker", "Install into Docker (here or on another machine)"),
    ("homeassistant", "Install into Home Assistant as an add-on"),
]


def ask(question: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        answer = input(f"{question}{suffix}: ").strip()
    except EOFError:
        answer = ""
    return answer or default


def yes(question: str, default: bool = True) -> bool:
    answer = ask(f"{question} ({'Y/n' if default else 'y/N'})").lower()
    return default if not answer else answer.startswith("y")


def choose() -> str:
    print("\nHow would you like to use Tolle?\n")
    for i, (_, label) in enumerate(CHOICES, 1):
        print(f"  {i}. {label}")
    while True:
        n = ask("\nChoose 1–5", "3")
        if n.isdigit() and 1 <= int(n) <= len(CHOICES):
            return CHOICES[int(n) - 1][0]
        print("Please type a number from 1 to 5.")


def run() -> None:
    from ..core.config import VERSION
    from . import docker, homeassistant, ollama, service, system
    rep = Reporter(False)
    print(f"\nTolle {VERSION} setup\n" + "=" * 24)
    try:
        mode = choose()
        port = int(ask("Port", "8099"))
        rec = ollama.recommend()

        if mode == "homeassistant":
            url = ask("Home Assistant address", "http://homeassistant.local:8123")
            print("Create a token in Home Assistant: your profile → Security → Long-lived access tokens.")
            token = os.environ.get("TOLLE_HA_TOKEN") or __import__("getpass").getpass("Access token (hidden): ")
            res = homeassistant.install(url, token, port, rep)
            print(f"\nDone. Open Tolle from the Home Assistant sidebar, or at {res['url']}")
            return

        if mode == "docker":
            host = ask("Docker host (leave empty for this computer, or ssh://user@server)", "")
            with_ollama = yes("Also run Ollama (local AI) in Docker?", True)
            res = docker.install(port, rep, host or None, with_ollama, rec["text_model"] if with_ollama else None)
            print(f"\nDone. Open {res['url']} and create your account. Compose file: {res['compose_file']}")
            return

        # personal / shared / server: Tolle runs directly on this machine
        ai = {}
        if yes(f"Install Ollama for private, local AI? (suggested model for {rec['ram_gb']} GB RAM: {rec['text_model']})"):
            ollama.install(rep)
            ollama.pull(rec["text_model"], rep)
            if yes(f"Also download {rec['vision_model']} to read photos of handwritten notes?", False):
                ollama.pull(rec["vision_model"], rep)
            ai = {"ai.provider": "ollama", "ollama.url": ollama.DEFAULT_URL, "ai.model": rec["text_model"],
                  "ollama.num_ctx": rec["context"]}

        data_dir = system.system_data_dir() if mode == "server" else system.user_data_dir()
        from ..core.config import save_server_config
        values = {"mode": mode, "port": port, "host": "127.0.0.1" if mode == "personal" else "0.0.0.0"}
        if ai:
            values["defaults"] = ai
        save_server_config(values, data_dir)

        if mode == "server" or yes("Start Tolle automatically in the background?", True):
            scope = "system" if mode == "server" else "user"
            service.install(scope, port, values["host"], rep)
            where = system.lan_addresses() if values["host"] != "127.0.0.1" else ["127.0.0.1"]
            print("\nDone. Tolle is running. Open one of these in a browser and create your account:")
            for ip in where:
                print(f"  http://{ip}:{port}")
            if mode != "personal":
                print("Phones: install the Tolle app and enter the address above.")
        else:
            print(f"\nDone. Start Tolle with: {' '.join(system.executable())} serve")
    except StepError as exc:
        rep.error(str(exc), exc.hint)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nSetup cancelled.")
        sys.exit(130)
