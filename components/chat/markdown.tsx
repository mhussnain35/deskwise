import React from "react";

/**
 * Small markdown renderer for streamed answers.
 *
 * Deliberately not a full parser: the text arrives token by token, so the
 * renderer has to cope with half-finished syntax on every frame. It handles the
 * shapes Gemini actually produces in support answers — headings, bullet and
 * numbered lists, bold, and inline code — and passes everything else through as
 * plain text rather than swallowing it.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[0.85em] text-indigo-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];

  let listItems: { marker: string; content: string }[] = [];
  let listOrdered = false;

  const flushList = (key: string) => {
    if (listItems.length === 0) return;

    const items = listItems.map((item, index) => (
      <li key={`${key}-item-${index}`} className="marker:text-indigo-400">
        {renderInline(item.content, `${key}-${index}`)}
      </li>
    ));
    listItems = [];

    blocks.push(
      listOrdered ? (
        <ol key={key} className="my-1.5 list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={key} className="my-1.5 list-disc space-y-1 pl-5">
          {items}
        </ul>
      )
    );
  };

  lines.forEach((line, index) => {
    const key = `line-${index}`;
    const trimmed = line.trim();

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);

    if (bullet) {
      if (listOrdered) flushList(`${key}-flush`);
      listOrdered = false;
      listItems.push({ marker: "•", content: bullet[1] });
      return;
    }

    if (numbered) {
      if (!listOrdered) flushList(`${key}-flush`);
      listOrdered = true;
      listItems.push({ marker: numbered[1], content: numbered[2] });
      return;
    }

    flushList(`${key}-flush`);

    if (heading) {
      blocks.push(
        <p key={key} className="mt-2 mb-1 font-semibold text-white first:mt-0">
          {renderInline(heading[2], key)}
        </p>
      );
      return;
    }

    if (trimmed === "") {
      blocks.push(<div key={key} className="h-2" />);
      return;
    }

    blocks.push(
      <p key={key} className="whitespace-pre-wrap">
        {renderInline(line, key)}
      </p>
    );
  });

  flushList("trailing");

  return <>{blocks}</>;
}
