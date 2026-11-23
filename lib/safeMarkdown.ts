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

export function safeMarkdownToHtml(text: string): string {
  const result = markdown.parse(text, { async: false });
  if (typeof result !== "string") throw new Error("Markdown rendering unexpectedly returned a promise.");
  return result;
}
