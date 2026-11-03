"""Entry point for the bundled tolle-server program (PyInstaller)."""
import multiprocessing

from server.cli import main

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
