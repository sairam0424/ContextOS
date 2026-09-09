import assert from "node:assert";
import { extractArticleMarkdown } from "../tools/browse-extract.js";

const ARTICLE_HTML = `
<html>
  <head><title>Getting Started — Widget Docs</title></head>
  <body>
    <nav><a href="/">Home</a><a href="/docs">Docs</a></nav>
    <article>
      <h1>Getting Started</h1>
      <p>Widget is a small library for building things quickly and reliably in
      modern applications, and this guide walks through the essentials that
      every new user needs before writing their first integration.</p>
      <p>Install it with your package manager of choice, then import the
      default export and call it with a configuration object describing the
      target environment, the desired output format, and any plugins you
      would like enabled for this particular build.</p>
      <h2>Configuration</h2>
      <p>Every option has a sensible default, so a minimal configuration is
      often enough to get a working setup, but production deployments
      typically override at least the output directory and the plugin list
      to match their own conventions and existing tooling.</p>
      <pre><code>widget.configure({ output: "dist" });</code></pre>
    </article>
    <footer>Copyright 2026</footer>
  </body>
</html>
`;

describe("browse-extract", () => {
  it("extracts the article title", () => {
    const { title } = extractArticleMarkdown(
      ARTICLE_HTML,
      "https://example.com/docs/start",
    );
    assert.match(title, /Getting Started/);
  });

  it("converts the article body to markdown, dropping nav and footer boilerplate", () => {
    const { markdown } = extractArticleMarkdown(
      ARTICLE_HTML,
      "https://example.com/docs/start",
    );
    assert.match(markdown, /Widget is a small library/);
    assert.match(markdown, /## Configuration/);
    assert.ok(
      !markdown.includes("Copyright 2026"),
      "footer boilerplate must be stripped by Readability",
    );
    assert.ok(
      !markdown.includes("Home"),
      "nav links must be stripped by Readability",
    );
  });

  it("renders a code block as a fenced markdown block", () => {
    const { markdown } = extractArticleMarkdown(
      ARTICLE_HTML,
      "https://example.com/docs/start",
    );
    assert.match(markdown, /```[\s\S]*widget\.configure/);
  });

  it("throws EXTRACT_EMPTY when the page has no extractable article content", () => {
    const empty = "<html><body><div>just a tiny fragment</div></body></html>";
    assert.throws(
      () => extractArticleMarkdown(empty, "https://example.com/blank"),
      /EXTRACT_EMPTY/,
    );
  });
});
