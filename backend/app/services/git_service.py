from __future__ import annotations
import os, re, shutil, socket, subprocess, uuid
import ipaddress
from urllib.parse import urlparse
from app.core.config import settings
from app.core.logging import get_logger
logger = get_logger("sentinel.git")

# C3: strict branch validation (flag-injection + traversal guard).
_BRANCH_RE = re.compile(r"^[A-Za-z0-9._\-/]{1,128}$")


class GitCloneError(Exception): pass


# C3: NAT64/DNS64 synthesis prefix (RFC 8219). ipaddress marks it
# is_reserved, but it is globally routable and legitimate — Docker/DNS64
# networks synthesise these for github.com. Must NOT be rejected (this
# exact false positive blocked all github.com scans).
_NAT64_WKP = ipaddress.ip_network("64:ff9b::/96")


def validate_branch(branch: str | None) -> str | None:
    """C3: return stripped branch or None; raise GitCloneError if invalid."""
    requested = (branch or "").strip() or None
    if not requested:
        return None
    if requested.startswith("-") or requested.startswith("/"):
        raise GitCloneError(f"Invalid branch name: {requested!r}")
    if not _BRANCH_RE.match(requested) or ".." in requested:
        raise GitCloneError(f"Invalid branch name: {requested!r}")
    return requested


def validate_clone_url(clone_url: str) -> str:
    """C3: SSRF guard — https only, allowlisted host, no creds, no private IPs.

    Returns the normalized URL. Raises GitCloneError on rejection.
    Stdlib only (urllib/socket/ipaddress) — no new deps.
    """
    url = (clone_url or "").strip()
    if not url:
        raise GitCloneError("Empty clone URL")
    if len(url) > 2048:
        raise GitCloneError("Clone URL too long")
    try:
        parsed = urlparse(url)
    except Exception:
        raise GitCloneError(f"Invalid clone URL: {url!r}")
    if parsed.scheme != "https":
        raise GitCloneError("Only https:// clone URLs are allowed")
    host = (parsed.hostname or "").lower()
    if not host:
        raise GitCloneError("Clone URL has no host")
    if parsed.username or parsed.password or "@" in parsed.netloc:
        raise GitCloneError("Credentials in clone URL are not allowed")
    if host not in settings.allowed_git_hosts_list:
        raise GitCloneError(f"Git host not allowed: {host!r}")
    # Resolve + reject private/loopback/link-local/reserved targets
    # (blocks http://github.com→169.254.169.254 style DNS rebinding + direct IP).
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise GitCloneError(f"Cannot resolve git host: {host!r}")
    addrs = {info[4][0] for info in infos}
    if not addrs:
        raise GitCloneError(f"Cannot resolve git host: {host!r}")
    for a in addrs:
        try:
            ip = ipaddress.ip_address(a)
        except ValueError:
            raise GitCloneError(f"Cannot resolve git host: {host!r}")
        # Block everything not globally routable (private/loopback/
        # link-local incl. 169.254.169.254 metadata, multicast, unspecified,
        # CGNAT, TEST-NET...). The only exception is the NAT64 synthesis
        # prefix, which is_reserved per ipaddress but legitimately routable.
        if not ip.is_global or ip.is_multicast:
            raise GitCloneError(f"Git host resolves to non-public address: {host!r}")
        if ip.is_reserved and not (ip.version == 6 and ip in _NAT64_WKP):
            raise GitCloneError(f"Git host resolves to non-public address: {host!r}")
    return url


def _git_env() -> dict[str, str]:
    """C3: non-interactive git — never prompt for credentials."""
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_ASKPASS"] = "true"
    return env


def _auth_args(token: str | None) -> list[str]:
    """C3: pass OAuth token via http.extraHeader, never in the URL
    (URL-embedded tokens leak into /proc, logs, and error messages)."""
    if not token:
        return []
    # Token with CR/LF would split headers — reject outright.
    if "\n" in token or "\r" in token:
        raise GitCloneError("Invalid token")
    return ["-c", f"http.extraHeader=Authorization: Bearer {token}"]


def _redact(text: str | None, token: str | None) -> str:
    if token and text:
        return text.replace(token, "***")
    return text or ""


def _inject_token(url: str, token: str | None) -> str:
    # C3: legacy helper kept for compatibility; new code paths use
    # _auth_args (header-based) so tokens never appear in URLs.
    if not token: return url
    parsed = urlparse(url)
    if parsed.scheme != "https": return url
    from urllib.parse import urlunparse
    return urlunparse(parsed._replace(netloc=f"x-access-token:{token}@{parsed.netloc}"))


def _run_clone(url: str, workspace: str, branch: str | None, token: str | None = None) -> None:
    # C3: `--filter=blob:none` keeps clones small (disk constraint);
    # `--` separates refs from paths so a branch can never become a flag.
    cmd = ["git", *_auth_args(token), "clone", "--depth", "1", "--filter=blob:none"]
    if branch:
        cmd += ["--single-branch", "--branch", branch]
    cmd += ["--", url, workspace]
    subprocess.run(cmd, capture_output=True, text=True,
        timeout=settings.CLONE_TIMEOUT_SECONDS, check=True, env=_git_env())


def _workspace_size_mb(workspace: str) -> float:
    """C3: enforce MAX_REPO_SIZE_MB. Try `du -sm` first (fast), fall back
    to os.walk (Windows / no-du environments). Never raises."""
    try:
        out = subprocess.run(["du", "-sm", workspace], capture_output=True,
                             text=True, timeout=30).stdout
        return float(out.split()[0])
    except Exception:
        pass
    total = 0
    try:
        for _root, _dirs, files in os.walk(workspace):
            for fn in files:
                try:
                    total += os.path.getsize(os.path.join(_root, fn))
                except OSError:
                    continue
    except OSError:
        pass
    return total / (1024 * 1024)


def _detect_default_branch(clone_url: str, token: str | None) -> str | None:
    """Best-effort `git ls-remote --symref` lookup. Returns None on any failure."""
    try:
        out = subprocess.run(
            ["git", *_auth_args(token), "ls-remote", "--symref", clone_url, "HEAD"],
            capture_output=True, text=True, timeout=20, check=True, env=_git_env()).stdout
        for line in out.splitlines():
            # e.g. "ref: refs/heads/master\tHEAD"
            if line.startswith("ref:"):
                ref = line.split()[1] if len(line.split()) > 1 else ""
                if ref.startswith("refs/heads/"):
                    return ref.removeprefix("refs/heads/")
        return None
    except Exception:
        return None


def clone_repository(clone_url: str, branch: str | None = "main", token: str | None = None) -> str:
    # C3: validate URL + branch BEFORE touching disk.
    clean_url = validate_clone_url(clone_url)
    requested = validate_branch(branch)
    os.makedirs(settings.WORKSPACE_ROOT, exist_ok=True)
    workspace = os.path.join(settings.WORKSPACE_ROOT, f"scan-{uuid.uuid4().hex}")
    try:
        if requested:
            try:
                _run_clone(clean_url, workspace, requested, token)
                _enforce_size(workspace, token)
                return workspace
            except subprocess.CalledProcessError as exc:
                stderr = exc.stderr or ""
                # Only fall back when the branch itself is missing — other errors (auth, not found, network) should surface.
                if "Remote branch" not in stderr and "Could not find remote branch" not in stderr:
                    cleanup_workspace(workspace); raise GitCloneError(f"Clone failed: {_redact(stderr, token)}") from exc
                logger.warning(f"Branch '{requested}' not found, falling back to default HEAD for {clean_url}")
                cleanup_workspace(workspace)
                # Fall through to default-HEAD clone below.
        _run_clone(clean_url, workspace, None, token)
        _enforce_size(workspace, token)
    except subprocess.TimeoutExpired as exc: cleanup_workspace(workspace); raise GitCloneError(f"Clone timed out") from exc
    except subprocess.CalledProcessError as exc:
        stderr = _redact(exc.stderr or "", token); cleanup_workspace(workspace); raise GitCloneError(f"Clone failed: {stderr}") from exc
    return workspace


def _enforce_size(workspace: str, token: str | None = None) -> None:
    """C3: enforce MAX_REPO_SIZE_MB post-clone (config was set, never read)."""
    limit = settings.MAX_REPO_SIZE_MB
    if not limit or limit <= 0:
        return
    size = _workspace_size_mb(workspace)
    if size > limit:
        cleanup_workspace(workspace)
        raise GitCloneError(f"Repository too large: {size:.0f} MB > {limit} MB limit")
def get_head_sha(workspace: str) -> str | None:
    try: return subprocess.run(["git","-C",workspace,"rev-parse","HEAD"],capture_output=True,text=True,timeout=15,check=True).stdout.strip()
    except Exception: return None
def get_current_branch(workspace: str) -> str | None:
    try: return subprocess.run(["git","-C",workspace,"rev-parse","--abbrev-ref","HEAD"],capture_output=True,text=True,timeout=15,check=True).stdout.strip()
    except Exception: return None
def cleanup_workspace(workspace: str) -> None:
    if workspace and os.path.isdir(workspace): shutil.rmtree(workspace, ignore_errors=True)


def sweep_orphan_workspaces(max_age_hours: int = 2) -> int:
    """C2: remove `scan-*` workspace dirs older than max_age_hours.

    Best-effort GC for workers killed mid-scan. Never raises.
    """
    import time
    try:
        root = settings.WORKSPACE_ROOT
        if not root or not os.path.isdir(root):
            return 0
        now = time.time()
        removed = 0
        for entry in os.listdir(root):
            if not entry.startswith("scan-"):
                continue
            full = os.path.join(root, entry)
            try:
                if now - os.path.getmtime(full) > max_age_hours * 3600:
                    shutil.rmtree(full, ignore_errors=True)
                    removed += 1
            except OSError:
                continue
        return removed
    except Exception:
        return 0
