from __future__ import annotations
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse
import httpx
from app.core.config import settings

_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token"
_API_BASE = "https://api.github.com"
_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"

class GitHubError(Exception): pass

def build_authorize_url(state: str) -> str:
    params = {"client_id": settings.GITHUB_CLIENT_ID, "redirect_uri": settings.GITHUB_CALLBACK_URL,
              "scope": "read:user user:email repo", "state": state, "allow_signup": "true"}
    return f"{_AUTHORIZE_URL}?{urlencode(params)}"

async def exchange_code_for_token(code: str) -> str:
    async with httpx.AsyncClient(timeout=20.0) as c:
        resp = await c.post(_OAUTH_TOKEN_URL, headers={"Accept": "application/json"},
            data={"client_id": settings.GITHUB_CLIENT_ID, "client_secret": settings.GITHUB_CLIENT_SECRET,
                  "code": code, "redirect_uri": settings.GITHUB_CALLBACK_URL})
    if resp.status_code != 200: raise GitHubError(f"Token exchange failed: HTTP {resp.status_code}")
    data = resp.json()
    if "error" in data: raise GitHubError(f"Token error: {data.get('error_description', data['error'])}")
    token = data.get("access_token")
    if not token: raise GitHubError("No access_token in response")
    return token

async def fetch_github_user(token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0, base_url=_API_BASE) as c:
        headers = _auth_headers(token)
        user = (await c.get("/user", headers=headers)).json()
        email = user.get("email")
        if not email:
            emails_resp = await c.get("/user/emails", headers=headers)
            if emails_resp.status_code == 200:
                primary = next((e for e in emails_resp.json() if e.get("primary") and e.get("verified")), None)
                if primary: email = primary["email"]
    return {"github_id": str(user["id"]), "github_username": user["login"],
            "email": email or f"{user['login']}@users.noreply.github.com",
            "full_name": user.get("name") or user["login"], "avatar_url": user.get("avatar_url")}

async def list_user_repos(token: str, per_page: int = 100) -> list[dict[str, Any]]:
    repos = []
    page = 1
    async with httpx.AsyncClient(timeout=30.0, base_url=_API_BASE) as c:
        headers = _auth_headers(token)
        while True:
            resp = await c.get("/user/repos", headers=headers,
                params={"per_page": per_page, "page": page, "sort": "updated",
                        "affiliation": "owner,collaborator,organization_member"})
            if resp.status_code != 200: raise GitHubError(f"List repos failed: HTTP {resp.status_code}")
            batch = resp.json()
            if not batch: break
            for r in batch:
                repos.append({"name": r["name"], "full_name": r["full_name"],
                    "clone_url": r["clone_url"], "default_branch": r.get("default_branch","main"),
                    "is_private": r.get("private", False), "description": r.get("description"),
                    "language": r.get("language"), "stars": r.get("stargazers_count", 0),
                    "updated_at": r.get("updated_at")})
            if len(batch) < per_page or page >= 20: break
            page += 1
    return repos

async def fetch_branches(token: str, full_name: str) -> list[str]:
    async with httpx.AsyncClient(timeout=20.0, base_url=_API_BASE) as c:
        resp = await c.get(f"/repos/{full_name}/branches", headers=_auth_headers(token), params={"per_page": 100})
        if resp.status_code != 200: raise GitHubError(f"Branches failed: HTTP {resp.status_code}")
        return [b["name"] for b in resp.json()]

def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"}
