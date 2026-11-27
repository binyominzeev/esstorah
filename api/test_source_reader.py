import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import h11
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

    def source(self, text="בראשית", ref=None, previous=None, following=None):
        return {"ref": ref or self.ref, "text": text, "prev": previous, "next": following}

    def test_only_linked_sources_are_available_and_page_is_safe(self):
        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "http://localhost:3000"}):
            page = self.client.get(self.url, params={"ref": self.ref})
        self.assertEqual(page.status_code, 200)
        self.assertIn("AI által készített fordítás", page.text)
        csp = page.headers["content-security-policy"]
        self.assertIn("frame-ancestors 'self' http://localhost:3000", csp)
        self.assertEqual(self.client.get(self.url, params={"ref": "Not linked"}).status_code, 404)
        self.assertEqual(self.client.get(self.url, params={"ref": "Other 1:1"}).status_code, 200)
        self.assertEqual(self.client.get("/api/map/invalid/source", params={"ref": self.ref}).status_code, 404)

    def test_reader_csp_is_valid_http_with_or_without_allowed_origins(self):
        for allowed in ("", "http://localhost:3000,http://127.0.0.1:3000"):
            with self.subTest(allowed=allowed), patch.dict("os.environ", {"ALLOWED_ORIGINS": allowed}):
                page = self.client.get(self.url, params={"ref": self.ref})
                self.assertEqual(page.status_code, 200)
                csp = page.headers["content-security-policy"]
                self.assertEqual(csp, csp.strip())
                h11.Response(status_code=200, headers=[("content-security-policy", csp)])
                if allowed:
                    self.assertIn("frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000", csp)
                else:
                    self.assertTrue(csp.endswith("frame-ancestors 'self'"))

    def test_source_and_translation_are_cached_and_translation_tracks_source_text(self):
        result = SimpleNamespace(text='{"paragraphs":[{"translation":"Kezdetben."}]}', error=None, truncated=False)
        with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value=self.source())) as fetch, \
                patch.object(source_reader.llm, "complete", new=AsyncMock(return_value=result)) as complete:
            for _ in range(2):
                self.assertEqual(self.client.get(self.url + "/text", params={"ref": self.ref}).json()["text"], "בראשית")
                response = self.client.post(self.url + "/translation", params={"ref": self.ref},
                                            headers=self.headers())
                self.assertEqual(response.json(), {"paragraphs": [{"hebrew": "בראשית", "translation": "Kezdetben."}]})
            self.assertEqual(fetch.await_count, 1)
            source_file = next(self.out.glob("**/source-texts/*.json"))
            source_file.write_text(json.dumps(self.source("חדש")), encoding="utf-8")
            response = self.client.post(self.url + "/translation", params={"ref": self.ref},
                                        headers=self.headers("חדש"))
            self.assertEqual(response.json(), {"paragraphs": [{"hebrew": "חדש", "translation": "Kezdetben."}]})
            self.assertEqual(complete.await_count, 2)
            self.assertEqual(complete.await_args_list[0].args[2], "בראשית")

    def test_rejects_missing_header_and_translation_failures(self):
        self.assertEqual(self.client.post(self.url + "/translation", params={"ref": self.ref}).status_code, 403)
        with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value=self.source())), \
                patch.object(source_reader.llm, "complete", new=AsyncMock(return_value=SimpleNamespace(
                    text='{"paragraphs":[{"translation":"fél"}]}', error=None, truncated=True))):
            response = self.client.post(self.url + "/translation", params={"ref": self.ref},
                                        headers=self.headers())
            self.assertEqual(response.status_code, 502)
            self.assertFalse(list(self.out.glob("**/source-translations/*.json")))

    def test_limit_and_long_source(self):
        with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value=self.source("א" * (source_reader.MAX_TEXT_CHARS + 1)))):
            response = self.client.post(self.url + "/translation", params={"ref": self.ref},
                                        headers=self.headers("א" * (source_reader.MAX_TEXT_CHARS + 1)))
            self.assertEqual(response.status_code, 413)
        next(self.out.glob("**/source-texts/*.json")).unlink()
        with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value=self.source())), \
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
            self.assertEqual(actual.json(), {**self.source(text), "hash": source_reader.source_hash(text), "back_ref": None})
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
        with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value=self.source("חדש"))), \
                patch.object(source_reader.llm, "complete", new=AsyncMock()) as complete:
            response = self.client.post(self.url + "/translation", params={"ref": self.ref}, headers=self.headers())
            self.assertEqual(response.status_code, 409)
            complete.assert_not_awaited()

    def test_simultaneous_requests_share_translation(self):
        async def run():
            async def complete(*args, **kwargs):
                await asyncio.sleep(0.02)
                return SimpleNamespace(text='{"paragraphs":[{"translation":"Kezdetben"}]}', error=None, truncated=False)

            with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value=self.source())), \
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

    def test_navigation_follows_only_sefaria_neighbors_and_caches_them(self):
        following = "Rashi on Genesis 1:1:2"
        sources = {
            self.ref: self.source(following=following),
            following: self.source("המשך", following, previous=self.ref),
        }
        with patch.object(source_reader, "fetch_text", new=AsyncMock(side_effect=lambda ref: sources[ref])) as fetch, \
                patch.object(source_reader.llm, "complete", new=AsyncMock(return_value=SimpleNamespace(
                    text='{"paragraphs":[{"translation":"Folytatás"}]}', error=None, truncated=False))):
            params = {"ref": self.ref, "path": "n"}
            current = self.client.get(self.url + "/text", params=params).json()
            self.assertEqual(current["ref"], following)
            self.assertEqual(current["back_ref"], self.ref)
            response = self.client.post(self.url + "/translation", params=params, headers=self.headers("המשך"))
            self.assertEqual(response.json()["paragraphs"][0]["translation"], "Folytatás")
            self.assertEqual(self.client.get(self.url + "/text", params={**params, "path": "np"}).json()["ref"], self.ref)
            self.assertEqual(fetch.await_count, 2)
            self.assertEqual(self.client.get(self.url + "/text", params={"ref": following}).status_code, 404)
            self.assertEqual(self.client.get(self.url + "/text", params={**params, "path": "x"}).status_code, 422)
            self.assertEqual(self.client.get(self.url + "/text", params={**params, "path": "nn"}).status_code, 404)

    def test_navigation_uses_segments_before_section_neighbors(self):
        segment = {"ref": self.ref, "sectionRef": "Rashi on Genesis 1:1",
                   "sections": ["1", "1", "1"], "toSections": ["1", "1", "1"], "textDepth": 3,
                   "prev": None, "next": "Rashi on Genesis 1:2",
                   "versions": [{"language": "he", "text": "ראשון"}]}
        section = {"versions": [{"language": "he", "text": ["ראשון", "", "שלישי"]}]}
        with patch.object(source_reader, "sefaria_response", new=AsyncMock(side_effect=[segment, section])):
            response = self.client.get(self.url + "/text", params={"ref": self.ref})
        self.assertEqual(response.json()["next"], "Rashi on Genesis 1:1:3")
        self.assertIsNone(response.json()["prev"])

    def test_served_map_includes_reader_links(self):
        with patch.object(server, "load_html", return_value="<html><head></head><body></body></html>"):
            client = TestClient(server.app)
            page = client.get("/api/map/Genesis.1.1/html")
            self.assertIn("esstorah-source-open", page.text)
            self.assertIn("sandbox", page.headers["content-security-policy"])
            client.close()

    def test_aligned_paragraphs_preserve_source_and_cached_result(self):
        first = "בראשית דבר ראשון. " * 20 + "\n\n"
        source = first + "המשך דבר שני וסיום."
        result = SimpleNamespace(text=json.dumps({"paragraphs": [
            {"translation": "Első bekezdés."},
            {"start": "המשך דבר שני", "translation": "Második bekezdés."},
        ]}), error=None, truncated=False)
        with patch.object(source_reader, "fetch_text", new=AsyncMock(return_value=self.source(source))), \
                patch.object(source_reader.llm, "complete", new=AsyncMock(return_value=result)) as complete:
            for _ in range(2):
                response = self.client.post(self.url + "/translation", params={"ref": self.ref},
                                            headers=self.headers(source))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["paragraphs"], [
                    {"hebrew": first, "translation": "Első bekezdés."},
                    {"hebrew": "המשך דבר שני וסיום.", "translation": "Második bekezdés."},
                ])
            self.assertEqual(complete.await_count, 1)

    def test_invalid_or_ambiguous_alignment_is_not_cached(self):
        source = "א" * 300 + " ראשון שני ראשון"
        for anchor in ("חסר", "ראשון", ""):
            result = SimpleNamespace(text=json.dumps({"paragraphs": [
                {"translation": "Első"}, {"start": anchor, "translation": "Második"},
            ]}), error=None, truncated=False)
            with self.subTest(anchor=anchor), \
                    patch.object(source_reader, "fetch_text", new=AsyncMock(return_value=self.source(source))), \
                    patch.object(source_reader.llm, "complete", new=AsyncMock(return_value=result)):
                response = self.client.post(self.url + "/translation", params={"ref": self.ref},
                                            headers=self.headers(source))
                self.assertEqual(response.status_code, 502)
                self.assertFalse(list(self.out.glob("**/source-translations/*.json")))

    def test_short_source_stays_in_one_paragraph(self):
        self.assertEqual(source_reader.aligned_paragraphs("ראשון שני", [
            {"translation": "Első."}, {"start": "שני", "translation": "Második."},
        ]), [{"hebrew": "ראשון שני", "translation": "Első. Második."}])


if __name__ == "__main__":
    unittest.main()
