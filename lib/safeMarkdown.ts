import { Marked, Renderer } from "marked";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const renderer = new Renderer();
renderer.html = ({ text }) => escapeHtml(text);
renderer.image = ({ text }) => escapeHtml(text);
renderer.link = function ({ href, tokens }) {
  const label = this.parser.parseInline(tokens);
  if (!/^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(href)) return label;
  return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>`;
};
const markdown = new Marked({ renderer, gfm: true, useNewRenderer: true });
const editedRenderer = new Renderer();
editedRenderer.html = renderer.html;
editedRenderer.image = renderer.image;
editedRenderer.link = function (token) {
  const match = /^([^/\\?#]+)\.md$/.exec(token.href);
  if (match) {
    return `<a href="#" class="commentary-link" data-commentary-id="${escapeHtml(match[1])}">${this.parser.parseInline(token.tokens)}</a>`;
  }
  return renderer.link.call(this, token);
};
const verseMarkdown = new Marked({ renderer: editedRenderer, gfm: true, useNewRenderer: true });
verseMarkdown.use({
  extensions: [{
    name: "wikiLink",
    level: "inline",
    start: (src) => src.indexOf("[["),
    tokenizer(src) {
      const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
      if (!match) return;
      return { type: "wikiLink", raw: match[0], id: match[2] ? match[1].trim() : match[1].trim().replace(/ /g, "-"), label: match[2] ?? match[1] };
    },
    renderer(token) {
      return `<a href="#" class="commentary-link" data-commentary-id="${escapeHtml(String(token.id))}">${escapeHtml(String(token.label))}</a>`;
    },
  }],
});

export function safeMarkdownToHtml(text: string): string {
  const result = markdown.parse(text, { async: false });
  if (typeof result !== "string") throw new Error("Markdown rendering unexpectedly returned a promise.");
  return result;
}

export function safeVerseMarkdownToHtml(text: string): string {
  const result = verseMarkdown.parseInline(text, { async: false });
  if (typeof result !== "string") throw new Error("Markdown rendering unexpectedly returned a promise.");
  return result;
}

export function safeEditedCommentaryToHtml(text: string): string {
  const result = verseMarkdown.parse(text, { async: false });
  if (typeof result !== "string") throw new Error("Markdown rendering unexpectedly returned a promise.");
  return result;
}
