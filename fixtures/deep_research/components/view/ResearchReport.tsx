import React from 'react';

interface Props {
  topic: string;
  executiveSummary: string;
  findings: string[];
  sources: string[];
  conclusion: string;
}

export default function ResearchReport({ topic, executiveSummary, findings, sources, conclusion }: Props) {
  return (
    <div className="research-report">
      <h1>Research Report: {topic}</h1>
      <section className="executive-summary">
        <h2>Executive Summary</h2>
        <p>{executiveSummary}</p>
      </section>
      <section className="findings">
        <h2>Key Findings</h2>
        <ul>
          {findings.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      </section>
      <section className="conclusion">
        <h2>Conclusion</h2>
        <p>{conclusion}</p>
      </section>
      <section className="sources">
        <h2>Sources</h2>
        <ul>
          {sources.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </section>
    </div>
  );
}
