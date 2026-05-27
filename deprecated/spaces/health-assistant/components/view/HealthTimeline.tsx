export interface TimelineEvent {
  date: string;
  type: string;
  title: string;
  details?: Record<string, unknown>;
  flagged?: boolean;
}

export interface HealthTimelineProps {
  events: TimelineEvent[];
  title?: string;
  highlightSince?: string;
  maxEvents?: number;
}

export function HealthTimeline({ events, title, highlightSince, maxEvents = 20 }: HealthTimelineProps) {
  return (
    <div>
      {title && <h2>{title}</h2>}
      <div className="health-timeline">
        {events.slice(0, maxEvents).map((event, i) => (
          <div
            key={i}
            className={`timeline-event type-${event.type} ${event.flagged ? "flagged" : ""} ${highlightSince && event.date >= highlightSince ? "highlighted" : ""}`}
          >
            <span className="event-date">{event.date}</span>
            <span className={`event-icon icon-${event.type}`} />
            <div className="event-content">
              <span className="event-title">{event.title}</span>
              {event.details && (
                <pre className="event-details">{JSON.stringify(event.details, null, 2)}</pre>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
