import { strict as assert } from "node:assert";
import { test } from "node:test";
import { safeMarkdownToHtml } from "./safeMarkdown.ts";

test("web Markdown preserves formatting but neutralizes executable HTML and links", () => {
  const html = safeMarkdownToHtml(
    "## **Cím**\n\n<script>alert(1)</script>\n\n[Jó](https://example.org) [Rossz](javascript:alert(1)) ![Kép](https://example.org/x.png)"
  );
  assert.match(html, /<h2><strong>Cím<\/strong><\/h2>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /href="https:\/\/example.org"/);
  assert.doesNotMatch(html, /<script|href="javascript:|<img/i);
});
