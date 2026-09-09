import assert from "node:assert";
import { assertSafeHttpUrl, slugifyUrl } from "../tools/browse-url.js";

describe("browse-url", () => {
  describe("assertSafeHttpUrl", () => {
    it("accepts a plain public https URL and returns a URL object", () => {
      const url = assertSafeHttpUrl("https://example.com/docs/getting-started");
      assert.strictEqual(url.hostname, "example.com");
      assert.strictEqual(url.pathname, "/docs/getting-started");
    });

    it("accepts http as well as https", () => {
      const url = assertSafeHttpUrl("http://example.com/changelog");
      assert.strictEqual(url.protocol, "http:");
    });

    it("rejects a malformed URL", () => {
      assert.throws(
        () => assertSafeHttpUrl("not a url"),
        /SEC_SSRF_INVALID_URL/,
      );
    });

    it("rejects a non-http(s) scheme", () => {
      assert.throws(
        () => assertSafeHttpUrl("file:///etc/passwd"),
        /SEC_SSRF_SCHEME/,
      );
      assert.throws(
        () => assertSafeHttpUrl("ftp://example.com/x"),
        /SEC_SSRF_SCHEME/,
      );
    });

    it("rejects localhost and loopback", () => {
      assert.throws(
        () => assertSafeHttpUrl("http://localhost/admin"),
        /SEC_SSRF_PRIVATE_HOST/,
      );
      assert.throws(
        () => assertSafeHttpUrl("http://127.0.0.1/admin"),
        /SEC_SSRF_PRIVATE_HOST/,
      );
    });

    it("rejects RFC1918 private ranges and link-local (incl. the cloud metadata address)", () => {
      assert.throws(
        () => assertSafeHttpUrl("http://10.0.0.5/"),
        /SEC_SSRF_PRIVATE_HOST/,
      );
      assert.throws(
        () => assertSafeHttpUrl("http://192.168.1.1/"),
        /SEC_SSRF_PRIVATE_HOST/,
      );
      assert.throws(
        () => assertSafeHttpUrl("http://172.16.0.1/"),
        /SEC_SSRF_PRIVATE_HOST/,
      );
      assert.throws(
        () => assertSafeHttpUrl("http://169.254.169.254/latest/meta-data"),
        /SEC_SSRF_PRIVATE_HOST/,
      );
    });

    it("rejects IPv6 loopback and link-local", () => {
      assert.throws(
        () => assertSafeHttpUrl("http://[::1]/"),
        /SEC_SSRF_PRIVATE_HOST/,
      );
      assert.throws(
        () => assertSafeHttpUrl("http://[fe80::1]/"),
        /SEC_SSRF_PRIVATE_HOST/,
      );
    });

    it("rejects .local mDNS hostnames", () => {
      assert.throws(
        () => assertSafeHttpUrl("http://printer.local/"),
        /SEC_SSRF_PRIVATE_HOST/,
      );
    });

    it("does not reject a public hostname that merely contains a blocked substring", () => {
      // Must match the FULL hostname, not substring — "10.example.com" is public.
      assert.doesNotThrow(() =>
        assertSafeHttpUrl("https://10.example.com/docs"),
      );
    });
  });

  describe("slugifyUrl", () => {
    it("produces a lowercase, hyphenated slug from hostname + path", () => {
      const slug = slugifyUrl(
        new URL("https://Example.com/Docs/Getting-Started"),
      );
      assert.match(slug, /^example-com-docs-getting-started-[0-9a-f]{8}$/);
    });

    it("is deterministic for the same URL", () => {
      const a = slugifyUrl(new URL("https://example.com/docs?x=1"));
      const b = slugifyUrl(new URL("https://example.com/docs?x=1"));
      assert.strictEqual(a, b);
    });

    it("differs for URLs that share a path but differ only in query string", () => {
      const a = slugifyUrl(new URL("https://example.com/docs?v=1"));
      const b = slugifyUrl(new URL("https://example.com/docs?v=2"));
      assert.notStrictEqual(
        a,
        b,
        "the hash suffix must be derived from the full URL, including the query string",
      );
    });

    it("falls back to 'page' when hostname+path has no alphanumeric characters", () => {
      const slug = slugifyUrl(new URL("https://example.com/"));
      assert.match(slug, /^example-com-[0-9a-f]{8}$/);
    });
  });
});
