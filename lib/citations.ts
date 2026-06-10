import type { CitationStyle, TitleRow } from "./types";

function splitAuthor(author: string): { last: string; first: string } {
  const a = (author || "").trim();
  if (!a) return { last: "", first: "" };
  if (a.includes(",")) {
    const [last, ...rest] = a.split(",");
    return { last: last.trim(), first: rest.join(",").trim() };
  }
  const parts = a.split(/\s+/);
  if (parts.length === 1) return { last: parts[0], first: "" };
  return { last: parts[parts.length - 1], first: parts.slice(0, -1).join(" ") };
}

function initials(first: string): string {
  return (first.match(/[A-Za-z]+/g) || []).map((p) => p[0].toUpperCase() + ".").join(" ");
}

export function formatCitation(t: TitleRow, style: CitationStyle = "apa7"): string {
  const title = (t.title || "").trim().replace(/\.$/, "");
  const year = (t.year || "").trim() || "n.d.";
  const publisher = (t.publisher || "").trim().replace(/\.$/, "");
  const { last, first } = splitAuthor(t.author || "");

  if (style === "apa7") {
    const author = last ? `${last}, ${initials(first)}`.replace(/,\s*$/, "") : "";
    const head = author ? `${author} (${year}). ` : `(${year}). `;
    const tail = publisher ? `${title}. ${publisher}.` : `${title}.`;
    return head + tail;
  }
  if (style === "mla9") {
    const author = last ? `${last}, ${first}`.replace(/,\s*$/, "") : "";
    return `${author ? author + ". " : ""}${title}. ${publisher}, ${year}.`.trim();
  }
  if (style === "chicago") {
    const author = last ? `${last}, ${first}`.replace(/,\s*$/, "") : "";
    return `${author ? author + ". " : ""}${year}. ${title}. ${publisher}.`.trim();
  }
  // harvard
  const author = last ? `${last}, ${initials(first)}`.replace(/,\s*$/, "") : "";
  const head = author ? `${author} ${year}, ` : `${year}, `;
  return (`${head}${title}, ${publisher}`).replace(/,\s*$/, "") + ".";
}
