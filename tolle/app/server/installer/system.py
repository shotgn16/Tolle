"""Facts about this computer: OS, memory, network addresses and where Tolle keeps things."""
import ctypes
import os
import platform
import shutil
import socket
import sys
from pathlib import Path

from ..core.config import APP_ID, APP_NAME

SYSTEM = platform.system()  # "Windows", "Darwin" or "Linux"


def total_ram_gb() -> float:
    try:
        if SYSTEM == "Windows":
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            return stat.ullTotalPhys / 1024**3
        if SYSTEM == "Darwin":
            import subprocess
            return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip()) / 1024**3
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024**3
    except Exception:
        return 8.0


def lan_addresses() -> list[str]:
    """IPv4 addresses other devices on the network can use to reach this computer."""
    found: list[str] = []
    try:  # the address used for outgoing traffic is almost always the right one
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))  # TEST-NET address: nothing is actually sent
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in found:
                found.append(ip)
    except OSError:
        pass
    return found


def hostname() -> str:
    return socket.gethostname()


def is_admin() -> bool:
    try:
        if SYSTEM == "Windows":
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        return os.geteuid() == 0
    except Exception:
        return False


def executable() -> list[str]:
    """Command that starts this server (the bundled binary, or Python + module in development)."""
    if getattr(sys, "frozen", False):
        return [sys.executable]
    return [sys.executable, "-m", "server"]


def source_dir() -> Path:
    """The folder containing the ``server`` package (development installs)."""
    return Path(__file__).resolve().parent.parent.parent


def user_data_dir() -> Path:
    if SYSTEM == "Windows":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / APP_NAME
    if SYSTEM == "Darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / APP_ID


def system_data_dir() -> Path:
    """Shared folder used when Tolle runs as a service for several people."""
    if SYSTEM == "Windows":
        return Path(os.environ.get("ProgramData") or "C:/ProgramData") / APP_NAME
    if SYSTEM == "Darwin":
        return Path("/Library/Application Support") / APP_NAME
    return Path("/var/lib") / APP_ID


def which(name: str) -> str | None:
    return shutil.which(name)
