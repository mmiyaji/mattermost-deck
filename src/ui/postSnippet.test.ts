import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderPostSnippet } from "./postHelpers";

describe("renderPostSnippet", () => {
  function links(message: string, query?: string) {
    return React.Children.toArray(renderPostSnippet(message, [], query))
      .filter((node): node is React.ReactElement<{ href: string; children: string }> => React.isValidElement(node) && node.type === "a");
  }

  it("keeps the entire destination when the normal summary ends inside a URL", () => {
    const url = "https://example.com/" + "path/".repeat(40) + "?page=2&mode=full#details";
    const [link] = links("説明 ".repeat(30) + url);
    expect(link.props.href).toBe(url);
    expect(link.props.children.length).toBeLessThan(url.length);
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, renderPostSnippet(url, [])));
    expect(html).toContain('href="' + url.replaceAll("&", "&amp;") + '"');
    expect(html).toContain('target="_blank"');
  });

  it("keeps the entire URL when a search excerpt starts and ends inside it", () => {
    const url = "https://example.com/" + "segment/".repeat(30) + "needle/" + "tail/".repeat(40);
    const [link] = links(url, "needle");
    expect(link.props.href).toBe(url);
    expect(link.props.children).not.toContain("https://");
  });

  it("also protects search results without a matching term", () => {
    const url = "https://example.com/" + "long/".repeat(50);
    expect(links("prefix " + url, "absent")[0].props.href).toBe(url);
  });

  it("does not mix up URLs with similar prefixes or include summary ellipses", () => {
    const first = "https://example.com/first";
    const second = "https://example.com/" + "second/".repeat(40);
    expect(links(first + " " + second).map(link => link.props.href)).toEqual([first, second]);
  });

  it("renders a non-URL excerpt as text without creating a link", () => {
    expect(links("plain text ".repeat(40))).toHaveLength(0);
    expect(renderToStaticMarkup(React.createElement(React.Fragment, null, renderPostSnippet("<script>alert(1)</script>", [])))).not.toContain("<script>");
  });
});
