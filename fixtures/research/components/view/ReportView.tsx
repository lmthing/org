import React from 'react';

interface Props {
  title: string;
  summary: string;
  sections?: Array<{ heading: string; content: string }>;
  sources?: string[];
}

export default function ReportView({ title, summary, sections = [], sources = [] }: Props) {
  return (
    <div className="report">
      <h1>{title}</h1>
      <p className="summary">{summary}</p>
      {sections.map((section, i) => (
        <div key={i}>
          <h2>{section.heading}</h2>
          <p>{section.content}</p>
        </div>
      ))}
      {sources.length > 0 && (
        <div className="sources">
          <h3>Sources</h3>
          <ul>{sources.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
