# PyInstaller recipe for the Tolle server – builds a folder ("onedir") containing tolle-server(.exe)
# and everything it needs (Python, libraries, the web app). Run from this folder:
#     pyinstaller --noconfirm tolle-server.spec
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

APP = Path(SPECPATH).resolve().parents[1] / "tolle" / "app"
sys.path.insert(0, str(APP))

hidden = (
    collect_submodules("server")            # features are imported by name at runtime
    + collect_submodules("uvicorn")
    + collect_submodules("websockets")
    + collect_submodules("qrcode")
    + collect_submodules("lxml")
    + ["tzdata", "multipart", "python_multipart", "email.mime.multipart"]
)
datas = [(str(APP / "web"), "web"), (str(APP / "VERSION"), ".")] + collect_data_files("tzdata") + collect_data_files("pypdfium2") \
    + collect_data_files("pypdfium2_raw") + collect_data_files("docx")

a = Analysis(
    ["entry.py"],
    pathex=[str(APP)],
    datas=datas,
    hiddenimports=hidden,
    excludes=["tkinter", "matplotlib", "numpy", "pytest", "IPython", "yaml", "chardet"],
    noarchive=False,
)
pyz = PYZ(a.pure)
icon = Path(SPECPATH) / ("icon.ico" if sys.platform == "win32" else "icon.icns")
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="tolle-server",
    console=True,
    icon=str(icon) if icon.exists() else None,
)
COLLECT(exe, a.binaries, a.datas, name="tolle-server")
