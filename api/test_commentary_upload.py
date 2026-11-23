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
from fastapi.testclient import TestClient

import auth_bookmarks
import commentary_upload
import import_commentary


class UserInfoClient:
    groups = []
    subject = "alice"

    def __init__(self, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def get(self, url, headers):
        import httpx
        return httpx.Response(200, json={"sub": self.subject, "groups": self.groups},
                              request=httpx.Request("GET", url))


class UploadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        app = FastAPI()
        app.include_router(auth_bookmarks.router, prefix="/api")
        app.include_router(commentary_upload.router, prefix="/api")
        cls.client = TestClient(app)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.parasha = self.root / "1 Berésit" / "Vájécé"
        self.parasha.mkdir(parents=True)
        (self.parasha / "HE.md").write_text("héber", encoding="utf-8")
        (self.parasha / "HU.md").write_text("# 29. fejezet\n**1.** a **2.** b\n", encoding="utf-8")
        self.env = patch.dict(os.environ, {"OIDC_ISSUER": "https://id.example", "OIDC_CLIENT_ID": "client",
                                          "OIDC_AUDIENCE": "client"})
        self.env.start()
        self.addCleanup(self.env.stop)
        key = SimpleNamespace(key=self.key.public_key())
        self.jwks = patch.object(auth_bookmarks, "jwks_for", return_value=SimpleNamespace(
            get_signing_key_from_jwt=lambda token: key))
        self.jwks.start()
        self.addCleanup(self.jwks.stop)
        self.info = patch.object(auth_bookmarks.httpx, "AsyncClient", UserInfoClient)
        self.info.start()
        self.addCleanup(self.info.stop)
        self.root_patch = patch.object(commentary_upload, "content_path", return_value=self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        UserInfoClient.groups = ["admins"]
        UserInfoClient.subject = "alice"
        self.source = {"filename": "vajece.md", "text":
                       "*Hetiszakasz: Vájecé (Berésit 28:10–32:3)*\n"
                       "## 1. 29:1–2 – Első\n\nSzöveg\n\n## 2. Második\n\nSzöveg\n"}

    def headers(self, **claims):
        payload = {"iss": "https://id.example", "aud": "client", "sub": "alice", "exp": int(time.time()) + 600}
        payload.update(claims)
        return {"Authorization": f"Bearer {jwt.encode(payload, self.key, algorithm='RS256')}"}

    def test_only_verified_admin_can_preview_or_upload(self):
        endpoint = "/api/admin/commentaries/preview"
        self.assertEqual(self.client.post(endpoint, json=self.source).status_code, 401)
        UserInfoClient.groups = ["users"]
        self.assertEqual(self.client.post(endpoint, headers=self.headers(groups=["admins"]), json=self.source).status_code, 403)
        self.assertEqual(self.client.post("/api/admin/commentaries", headers=self.headers(),
                                         json={**self.source, "selected": [{"number": 1, "markdown": "## Cím"}]}).status_code, 403)
        UserInfoClient.groups = ["admins"]
        self.assertEqual(self.client.post(endpoint, headers=self.headers(aud="other"), json=self.source).status_code, 401)
        UserInfoClient.subject = "bob"
        self.assertEqual(self.client.post(endpoint, headers=self.headers(), json=self.source).status_code, 502)
        self.assertFalse((self.parasha / "perusim").exists())

    def test_preview_selected_edit_persist_and_live_feed(self):
        response = self.client.post("/api/admin/commentaries/preview", headers=self.headers(), json=self.source)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["parasha"], "Vájécé")
        self.assertEqual([n["refs"] for n in data["notes"]], ["29:1,29:2", "29:1,29:2"])
        payload = {**self.source, "selected": [{"number": 2, "markdown": "## Második\n\nSzerkesztett szöveg."}]}
        upload = self.client.post("/api/admin/commentaries", headers=self.headers(), json=payload)
        self.assertEqual(upload.status_code, 200, upload.text)
        self.assertEqual(upload.json()["count"], 1)
        saved = self.parasha / "perusim" / "web-vajece-02.md"
        self.assertIn("Szerkesztett szöveg.", saved.read_text(encoding="utf-8"))
        live = self.client.get("/api/commentaries/Vajece").json()["commentaries"]
        self.assertEqual(len(live), 1)
        self.assertEqual(live[0]["id"], "web-vajece-02")
        self.assertEqual(live[0]["verses"], [{"chapter": 29, "verse": 1}, {"chapter": 29, "verse": 2}])
        self.assertEqual(self.client.post("/api/admin/commentaries", headers=self.headers(), json=payload).status_code, 422)
        self.assertIn("Szerkesztett szöveg.", saved.read_text(encoding="utf-8"))
        conflict = {**self.source, "selected": [{"number": 1, "markdown": "## Első"},
                                                {"number": 2, "markdown": "## Második"}]}
        self.assertEqual(self.client.post("/api/admin/commentaries", headers=self.headers(), json=conflict).status_code, 422)
        self.assertFalse((self.parasha / "perusim" / "web-vajece-01.md").exists())

    def test_rejects_tampering_and_path_escape(self):
        for selected in ([{"number": 99, "markdown": "## Cím\n\nszöveg"}],
                         [{"number": 1, "markdown": "---\nmytorah-verses: \"29:2\""}],
                         [{"number": 1, "markdown": "## Cím"}, {"number": 1, "markdown": "## Más"}]):
            response = self.client.post("/api/admin/commentaries", headers=self.headers(),
                                        json={**self.source, "selected": selected})
            self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.post("/api/admin/commentaries/preview", headers=self.headers(),
                                         json={**self.source, "filename": "../vajece.md"}).status_code, 422)
        self.assertFalse((self.parasha / "perusim").exists())

    def test_preview_upload_and_feed_use_literal_env_without_node(self):
        project = self.root / "project"
        project.mkdir()
        (project / ".env.local").write_text(f'CONTENT_PATH="{self.root}"\n', encoding="utf-8")
        env = {"OIDC_ISSUER": "https://id.example", "OIDC_CLIENT_ID": "client", "OIDC_AUDIENCE": "client"}
        with patch.dict(os.environ, env, clear=True), \
             patch.object(import_commentary, "PROJECT_ROOT", project), \
             patch.object(commentary_upload, "content_path", import_commentary.content_path), \
             patch.object(import_commentary.subprocess, "run", side_effect=AssertionError("Node should not run")):
            preview = self.client.post("/api/admin/commentaries/preview", headers=self.headers(), json=self.source)
            self.assertEqual(preview.status_code, 200, preview.text)
            payload = {**self.source, "selected": [{"number": 1, "markdown": "## Első\n\nSzöveg."}]}
            upload = self.client.post("/api/admin/commentaries", headers=self.headers(), json=payload)
            self.assertEqual(upload.status_code, 200, upload.text)
            live = self.client.get("/api/commentaries/Vajece")
            self.assertEqual(live.status_code, 200, live.text)
            self.assertEqual(len(live.json()["commentaries"]), 1)


if __name__ == "__main__":
    unittest.main()
