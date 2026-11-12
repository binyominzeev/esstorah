import os
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

import auth_bookmarks


class BookmarkApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        app = FastAPI()
        app.include_router(auth_bookmarks.router, prefix="/api")
        cls.client = TestClient(app)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "OIDC_ISSUER": "https://id.example",
            "OIDC_CLIENT_ID": "client",
            "OIDC_CLIENT_SECRET": "secret",
            "OIDC_REDIRECT_URI": "https://example.test/",
            "OIDC_AUDIENCE": "client",
            "BOOKMARKS_DATABASE_PATH": str(Path(self.directory.name) / "bookmarks.db"),
        })
        self.env.start()
        key = SimpleNamespace(key=self.key.public_key())
        self.jwks = patch.object(auth_bookmarks, "jwks_for", return_value=SimpleNamespace(
            get_signing_key_from_jwt=lambda token: key,
        ))
        self.jwks.start()

    def tearDown(self):
        self.jwks.stop()
        self.env.stop()
        self.directory.cleanup()

    def headers(self, sub="alice", **claims):
        payload = {"iss": "https://id.example", "aud": "client", "sub": sub, "exp": int(time.time()) + 600}
        payload.update(claims)
        token = jwt.encode(payload, self.key, algorithm="RS256")
        return {"Authorization": f"Bearer {token}"}

    def test_bookmarks_are_persistent_idempotent_and_user_scoped(self):
        item = {"parasha": "Lech-lecha", "ref": "Genesis.17.17", "kind": "question", "text": "Miért?"}
        first = self.client.post("/api/bookmarks", headers=self.headers(), json=item)
        self.assertEqual(first.status_code, 200)
        bookmark = first.json()
        self.assertEqual(self.client.post("/api/bookmarks", headers=self.headers(), json=item).json()["id"], bookmark["id"])
        answer = {**item, "kind": "answer", "text": "Ezért."}
        self.assertEqual(self.client.post("/api/bookmarks", headers=self.headers(), json=answer).status_code, 200)
        self.assertEqual(len(self.client.get("/api/bookmarks", headers=self.headers()).json()["bookmarks"]), 2)
        self.assertEqual(self.client.get("/api/bookmarks", headers=self.headers("bob")).json()["bookmarks"], [])
        self.assertEqual(self.client.delete(f"/api/bookmarks/{bookmark['id']}", headers=self.headers("bob")).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/bookmarks/{bookmark['id']}", headers=self.headers()).status_code, 204)
        self.assertEqual(len(self.client.get("/api/bookmarks", headers=self.headers()).json()["bookmarks"]), 1)

    def test_authentication_and_input_validation(self):
        self.assertEqual(self.client.get("/api/bookmarks").status_code, 401)
        self.assertEqual(self.client.get("/api/bookmarks", headers=self.headers(aud="other")).status_code, 401)
        self.assertEqual(self.client.get("/api/bookmarks", headers=self.headers(exp=1)).status_code, 401)
        self.assertEqual(self.client.post("/api/bookmarks", headers=self.headers(), json={
            "parasha": "Lech-lecha", "ref": "../../bad", "kind": "question", "text": "x",
        }).status_code, 422)

    def test_exchange_checks_redirect_and_forwards_pkce(self):
        with patch.object(auth_bookmarks, "exchange", return_value=JSONResponse({"access_token": "token"})) as exchange:
            invalid = self.client.post("/api/auth/token", data={
                "code": "code", "code_verifier": "verifier", "redirect_uri": "https://example.test",
            })
            self.assertEqual(invalid.status_code, 400)
            valid = self.client.post("/api/auth/token", data={
                "code": "code", "code_verifier": "verifier", "redirect_uri": "https://example.test/",
            })
            self.assertEqual(valid.status_code, 200)
            exchange.assert_awaited_once_with({
                "grant_type": "authorization_code", "code": "code", "code_verifier": "verifier",
                "redirect_uri": "https://example.test/",
            })
            self.assertEqual(self.client.post("/api/auth/refresh", data={"refresh_token": ""}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
