export interface BriefingPreferencesProps {
  submitLabel?: string;
}

export interface BriefingPreferencesResult {
  format: "morning_digest" | "breaking_news" | "topic_deep_dive";
  categories: string[];
  maxArticlesPerCategory: number;
  includeSummaries: boolean;
  credibilityThreshold: number;
}

export function BriefingPreferences({
  submitLabel = "Save Preferences",
}: BriefingPreferencesProps) {
  return (
    <form>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 14, marginBottom: 4, fontWeight: 600 }}>
          Briefing Format
        </label>
        <select name="format" style={{ padding: 8, fontSize: 14, border: "1px solid #ddd", borderRadius: 4, width: "100%", boxSizing: "border-box" }}>
          <option value="morning_digest">Morning Digest — broad overview across categories</option>
          <option value="breaking_news">Breaking News — latest urgent stories only</option>
          <option value="topic_deep_dive">Topic Deep Dive — detailed analysis of one topic</option>
        </select>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 14, marginBottom: 4, fontWeight: 600 }}>
          Categories
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {["politics", "technology", "business", "science", "health", "world", "sports", "culture"].map((cat) => (
            <label key={cat} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
              <input type="checkbox" name="categories" value={cat} defaultChecked />
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Max articles per category</label>
          <input name="maxArticlesPerCategory" type="number" min={1} max={20} defaultValue={5} style={{ padding: 6, fontSize: 13, border: "1px solid #ddd", borderRadius: 4, width: 80 }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Credibility threshold</label>
          <select name="credibilityThreshold" style={{ padding: 6, fontSize: 13, border: "1px solid #ddd", borderRadius: 4 }}>
            <option value="0.3">Low (show all)</option>
            <option value="0.5">Medium</option>
            <option value="0.7" selected>High (trusted sources)</option>
            <option value="0.9">Very High (wire services only)</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" name="includeSummaries" defaultChecked />
          Include AI-generated summaries for featured articles
        </label>
      </div>

      <button type="submit" style={{ padding: "8px 24px", background: "#3498db", color: "#fff", border: "none", borderRadius: 4, fontSize: 14, cursor: "pointer" }}>
        {submitLabel}
      </button>
    </form>
  );
}
