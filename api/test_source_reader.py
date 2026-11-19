import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

import server
import source_reader


class SourceReaderTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.out = Path(self.directory.name)
        folder = self.out / "Genesis.1.1"
        folder.mkdir()
        self.ref = "Rashi on Genesis 1:1:1"
        (folder / "result-test.json").write_text(json.dumps({
            "groups": [{"clusters": [{"answers": [
                {"sources": [{"commentator": "Rashi", "ref": self.ref}]},
                {"commentator": "Old format", "ref": "Other 1:1"},
            ]}]}],
        }), encoding="utf-8")
        app = FastAPI()
        app.include_router(source_reader.router(self.out, server.parse))
        self.app = app
        self.client = TestClient(app)
        self.url = "/api/map/Genesis.1.1/source"
        source_reader.started.clear()

    def tearDown(self):
        self.client.close()
        self.directory.cleanup()

    def headers(self, text="בראשית"):
        return {"X-Source-Reader": "1", "X-Source-Hash": source_reader.source_hash(text)}

    def test_only_linked_sources_are_available_and_page_is_safe(self):
        page = self.client.get(self.url, params={"ref": self.ref})
        self.assertEqual(page.status_code, 200)
        self.assertIn("AI által készített fordítás", page.text)
        self.assertEqual(self.client.get(self.url, params={"ref": "Not linked"}).status_code, 404)
        self.assertEqual(self.client.get(self.url, params={"ref": "Other 1:1"}).status_code, 200)
        self.assertEqual(self.client.get("/api/map/invalid/source", params={"ref": self.ref}).status_code, 404)

    def test_translation_is_cached_and_invalidated_by_source_text(self):
        result = SimpleNamespace(text='{"translation":"Kezdetben."}', error=None, truncated=False)
        with patch.object(source_reader, "fetch_text", new=AsyncMock(side_effect=["בראשית", "בראשית", "חדש"])), \
                patch.object(source_reader.llm, "complete", new=AsyncMock(return_value=result)) as complete:
            for text in ["בראשית", "בראשית", "חדש"]:
                response = self.client.post(self.url + "/translation", params={"ref": self.ref},
                                            headers=self.headers(text))
                self.assertEqual(response.json(), {"translation": "Kezdetben."})
            self.assertEqual(complete.await_count, 2)
            self.assertEqual(complete.await_args_list[0].args[2], "בראשית")

    def test_rejects_missing_header_and_translation_failures(self):
        self.assertEqual(self.client.post(self.url + "/translation", params={"ref": self.ref}).status_code, 403)
        with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value="בראשית")), \
                patch.object(source_reader.llm, "complete", new=AsyncMock(return_value=SimpleNamespace(
                    text='{"translation":"fél"}', error=None, truncated=True))):
            response = self.client.post(self.url + "/translation", params={"ref": self.ref},
                                        headers=self.headers())
            self.assertEqual(response.status_code, 502)
            self.assertFalse(list(self.out.glob("**/source-translations/*.json")))

    def test_limit_and_long_source(self):
        with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value="א" * (source_reader.MAX_TEXT_CHARS + 1))):
            response = self.client.post(self.url + "/translation", params={"ref": self.ref},
                                        headers=self.headers("א" * (source_reader.MAX_TEXT_CHARS + 1)))
            self.assertEqual(response.status_code, 413)
        with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value="בראשית")), \
                patch.object(source_reader, "MAX_TRANSLATIONS_PER_DAY", 0):
            response = self.client.post(self.url + "/translation", params={"ref": self.ref},
                                        headers=self.headers())
            self.assertEqual(response.status_code, 429)

    def test_sefaria_text_is_cleaned_and_not_replaced_by_english(self):
        response = httpx.Response(200, json={"versions": [
            {"language": "en", "text": "In the beginning"},
            {"text": ["<b>בְּרֵאשִׁית</b>", "דבר<br>שני"]},
        ]}, request=httpx.Request("GET", "https://www.sefaria.org"))
        with patch.object(source_reader.httpx, "AsyncClient") as client:
            client.return_value.__aenter__.return_value.get = AsyncMock(return_value=response)
            actual = self.client.get(self.url + "/text", params={"ref": self.ref})
            text = "בְּרֵאשִׁית\nדבר\nשני"
            self.assertEqual(actual.json(), {"text": text, "hash": source_reader.source_hash(text)})
            called_url = client.return_value.__aenter__.return_value.get.await_args.args[0]
            self.assertIn("Rashi%20on%20Genesis%201%3A1%3A1", called_url)
            self.assertIn("version=hebrew", called_url)

    def test_missing_hebrew_is_reported(self):
        response = httpx.Response(200, json={"versions": []},
                                  request=httpx.Request("GET", "https://www.sefaria.org"))
        with patch.object(source_reader.httpx, "AsyncClient") as client:
            client.return_value.__aenter__.return_value.get = AsyncMock(return_value=response)
            self.assertEqual(self.client.get(self.url + "/text", params={"ref": self.ref}).status_code, 404)

    def test_changed_source_is_not_translated(self):
        with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value="חדש")), \
                patch.object(source_reader.llm, "complete", new=AsyncMock()) as complete:
            response = self.client.post(self.url + "/translation", params={"ref": self.ref}, headers=self.headers())
            self.assertEqual(response.status_code, 409)
            complete.assert_not_awaited()

    def test_simultaneous_requests_share_translation(self):
        async def run():
            async def complete(*args, **kwargs):
                await asyncio.sleep(0.02)
                return SimpleNamespace(text='{"translation":"Kezdetben"}', error=None, truncated=False)

            with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value="בראשית")), \
                    patch.object(source_reader.llm, "complete", new=AsyncMock(side_effect=complete)) as model:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),
                                             base_url="http://test") as client:
                    responses = await asyncio.gather(*(
                        client.post(self.url + "/translation", params={"ref": self.ref}, headers=self.headers())
                        for _ in range(2)
                    ))
                self.assertEqual([r.status_code for r in responses], [200, 200])
                self.assertEqual(model.await_count, 1)

        asyncio.run(run())

    def test_served_map_includes_reader_links(self):
        with patch.object(server, "load_html", return_value="<html><head></head><body></body></html>"):
            client = TestClient(server.app)
            page = client.get("/api/map/Genesis.1.1/html")
            self.assertIn("url.searchParams.set('ref', link.title)", page.text)
            self.assertIn("sandbox", page.headers["content-security-policy"])
            client.close()


if __name__ == "__main__":
    unittest.main()
