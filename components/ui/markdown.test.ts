import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./markdown";

const mentions = [{ id: "user-1", username: "baopx", name: "Bao PX" }];

describe("MarkdownView resolved mentions", () => {
  it("renders a resolved username as the user's display name with the handle as a tooltip", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownView, { mentions, children: "Please review @baopx." }),
    );
    expect(html).toContain("@Bao PX");
    expect(html).toContain('title=\"@baopx\"');
    expect(html).not.toContain("review @baopx");
  });

  it("does not transform email addresses, inline code, or unresolved handles", () => {
    const html = renderToStaticMarkup(
      createElement(
        MarkdownView,
        {
          mentions,
          children: "Mail a@baopx.com, run `notify @baopx`, then ask @missinguser.",
        },
      ),
    );
    expect(html).toContain("a@baopx.com");
    expect(html).toContain("<code>notify @baopx</code>");
    expect(html).toContain("@missinguser");
    expect(html).not.toContain("@Bao PX");
  });
});
