export interface SearchQueryProps {
  placeholder?: string;
  submitLabel?: string;
}

export interface SearchQueryResult {
  query: string;
  freshness: "hour" | "day" | "week" | "month" | "year" | "all";
  domains?: string[];
}

export function SearchQuery({
  placeholder = "Search for news...",
  submitLabel = "Search",
}: SearchQueryProps) {
  return (
    <form>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 14, marginBottom: 4, fontWeight: 600 }}>
          Search Query
        </label>
        <input
          name="query"
          type="text"
          placeholder={placeholder}
          style={{ width: "100%", padding: 8, fontSize: 14, border: "1px solid #ddd", borderRadius: 4, boxSizing: "border-box" }}
          required
        />
      </div>
      <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Freshness</label>
          <select name="freshness" style={{ padding: 6, fontSize: 13, border: "1px solid #ddd", borderRadius: 4 }}>
            <option value="all">All time</option>
            <option value="hour">Past hour</option>
            <option value="day" selected>Past 24 hours</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
            <option value="year">Past year</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
            Restrict to domains <span style={{ color: "#999" }}>(comma-separated, optional)</span>
          </label>
          <input
            name="domains"
            type="text"
            placeholder="reuters.com, apnews.com"
            style={{ width: "100%", padding: 6, fontSize: 13, border: "1px solid #ddd", borderRadius: 4, boxSizing: "border-box" }}
          />
        </div>
      </div>
      <button type="submit" style={{ padding: "8px 24px", background: "#3498db", color: "#fff", border: "none", borderRadius: 4, fontSize: 14, cursor: "pointer" }}>
        {submitLabel}
      </button>
    </form>
  );
}
