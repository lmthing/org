export interface LabValue {
  testName: string;
  value: number | string;
  unit: string;
  referenceRange?: string;
  flag?: "normal" | "high" | "low" | "critical";
}

export interface LabResultCardProps {
  panelName: string;
  date: string;
  values: LabValue[];
  labName?: string;
  notes?: string;
}

export function LabResultCard({ panelName, date, values, labName, notes }: LabResultCardProps) {
  return (
    <div className="lab-result-card">
      <div className="lab-header">
        <h3>{panelName}</h3>
        <span className="lab-date">{date}</span>
      </div>
      {labName && <div className="lab-facility">{labName}</div>}
      <table className="lab-values">
        <thead>
          <tr>
            <th>Test</th>
            <th>Result</th>
            <th>Reference</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {values.map((v, i) => (
            <tr key={i} className={`value-row ${v.flag ?? ""}`}>
              <td>{v.testName}</td>
              <td>{`${v.value} ${v.unit}`}</td>
              <td>{v.referenceRange ?? "--"}</td>
              <td className={`flag flag-${v.flag ?? "normal"}`}>{v.flag ?? "normal"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {notes && <div className="lab-notes">{notes}</div>}
    </div>
  );
}
