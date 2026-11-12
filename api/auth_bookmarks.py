"""Pocket ID token proxy and user-scoped bookmarks."""
import os
import re
import sqlite3
from contextlib import closing
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs

import httpx
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

router = APIRouter()


def settings():
    return (
        os.environ.get("OIDC_ISSUER", "").rstrip("/"),
        os.environ.get("OIDC_CLIENT_ID", ""),
        os.environ.get("OIDC_CLIENT_SECRET", ""),
        os.environ.get("OIDC_REDIRECT_URI", ""),
    )


@lru_cache(maxsize=4)
def jwks_for(issuer: str):
    return jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json")


def require_user(authorization: str = Header(default="")) -> str:
    issuer, _, _, _ = settings()
    if not issuer:
        raise HTTPException(503, "A bejelentkezés nincs beállítva.")
    match = re.fullmatch(r"Bearer\s+(\S+)", authorization, re.IGNORECASE)
    if not match:
        raise HTTPException(401, "Bejelentkezés szükséges.")
    try:
        key = jwks_for(issuer).get_signing_key_from_jwt(match.group(1))
        audience = os.environ.get("OIDC_AUDIENCE") or None
        claims = jwt.decode(
            match.group(1), key.key, algorithms=["RS256", "ES256", "EdDSA"],
            issuer=issuer, audience=audience,
            options={"require": ["exp", "iss", "sub"], "verify_aud": bool(audience)},
        )
        if not isinstance(claims["sub"], str) or not claims["sub"]:
            raise jwt.InvalidTokenError("Missing subject")
        return claims["sub"]
    except jwt.PyJWKClientConnectionError as exc:
        raise HTTPException(503, "Az azonosító szolgáltatás nem érhető el.") from exc
    except jwt.PyJWTError:
        raise HTTPException(401, "Érvénytelen vagy lejárt bejelentkezés.")


@router.get("/auth/config")
def auth_config():
    issuer, client_id, _, _ = settings()
    if not issuer or not client_id:
        raise HTTPException(503, "A bejelentkezés nincs beállítva.")
    return {"issuer": issuer, "clientId": client_id}


async def exchange(params: dict[str, str]):
    issuer, client_id, secret, _ = settings()
    if not issuer or not client_id or not secret:
        raise HTTPException(503, "A bejelentkezés nincs beállítva.")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{issuer}/api/oidc/token",
                data={"client_id": client_id, "client_secret": secret, **params},
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, "Az azonosító szolgáltatás nem érhető el.") from exc
    return Response(content=response.content, status_code=response.status_code,
                    media_type="application/json", headers={"Cache-Control": "no-store"})


async def form_data(request: Request) -> dict[str, str]:
    body = await request.body()
    if len(body) > 10000:
        raise HTTPException(413, "A kérés túl nagy.")
    try:
        parsed = parse_qs(body.decode("utf-8"), keep_blank_values=True, max_num_fields=10)
    except (UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(400, "Érvénytelen kérés.") from exc
    if any(len(values) != 1 for values in parsed.values()):
        raise HTTPException(400, "Érvénytelen kérés.")
    return {key: values[0] for key, values in parsed.items()}


@router.post("/auth/token")
async def token(request: Request):
    form = await form_data(request)
    redirect = settings()[3]
    if not redirect:
        raise HTTPException(503, "A bejelentkezés nincs beállítva.")
    if not form.get("code") or not form.get("code_verifier") or form.get("redirect_uri") != redirect:
        raise HTTPException(400, "Érvénytelen bejelentkezési kérés.")
    return await exchange({"grant_type": "authorization_code", "code": form["code"],
                           "code_verifier": form["code_verifier"], "redirect_uri": redirect})


@router.post("/auth/refresh")
async def refresh(request: Request):
    form = await form_data(request)
    if not form.get("refresh_token"):
        raise HTTPException(400, "Érvénytelen frissítési kérés.")
    return await exchange({"grant_type": "refresh_token", "refresh_token": form["refresh_token"]})


class BookmarkInput(BaseModel):
    parasha: str = Field(min_length=1, max_length=150, pattern=r"^[A-Za-z0-9_-]+$")
    ref: str = Field(min_length=1, max_length=100, pattern=r"^\w+\.\d+\.\d+$")
    kind: Literal["question", "answer"]
    text: str = Field(min_length=1, max_length=10000)


def database():
    path = Path(os.environ.get("BOOKMARKS_DATABASE_PATH", Path(__file__).parent / "data" / "bookmarks.sqlite3"))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("""CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, parasha TEXT NOT NULL,
        ref TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, parasha, ref, kind, text)
    )""")
    return db


@router.get("/bookmarks")
def list_bookmarks(user: str = Depends(require_user)):
    with closing(database()) as db, db:
        rows = db.execute(
            "SELECT id, parasha, ref, kind, text, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC, id DESC",
            (user,),
        ).fetchall()
    return {"bookmarks": [dict(row) for row in rows]}


@router.post("/bookmarks")
def add_bookmark(item: BookmarkInput, user: str = Depends(require_user)):
    text = item.text.strip()
    if not text:
        raise HTTPException(422, "Az üres szöveg nem könyvjelzőzhető.")
    with closing(database()) as db, db:
        db.execute(
            "INSERT OR IGNORE INTO bookmarks (user_id, parasha, ref, kind, text) VALUES (?, ?, ?, ?, ?)",
            (user, item.parasha, item.ref, item.kind, text),
        )
        row = db.execute(
            "SELECT id, parasha, ref, kind, text, created_at FROM bookmarks WHERE user_id = ? AND parasha = ? AND ref = ? AND kind = ? AND text = ?",
            (user, item.parasha, item.ref, item.kind, text),
        ).fetchone()
    return dict(row)


@router.delete("/bookmarks/{bookmark_id}", status_code=204)
def delete_bookmark(bookmark_id: int, user: str = Depends(require_user)):
    with closing(database()) as db, db:
        result = db.execute("DELETE FROM bookmarks WHERE id = ? AND user_id = ?", (bookmark_id, user))
        if not result.rowcount:
            raise HTTPException(404, "A könyvjelző nem található.")
