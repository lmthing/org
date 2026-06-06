import React from 'react';

interface Props {
  url: string;
  title: string;
  summary: string;
  links?: Array<{ href: string; text: string }>;
}

export default function PageSummary({ url, title, summary, links = [] }: Props) {
  return (
    <div className="page-summary">
      <h1>{title}</h1>
      <p className="url">{url}</p>
      <p className="summary">{summary}</p>
      {links.length > 0 && (
        <div className="links">
          <h3>Key Links ({links.length})</h3>
          <ul>
            {links.slice(0, 10).map((l, i) => (
              <li key={i}><a href={l.href}>{l.text || l.href}</a></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
