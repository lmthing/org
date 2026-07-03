import React from 'react';
import { Dialog } from '../components/ui/Dialog.js';
import { Input } from '../components/ui/Input.js';
import { Textarea } from '../components/ui/Textarea.js';
import { Button } from '../components/ui/Button.js';
import { useStore } from '../store/store.js';
import { authHeaders } from './auth.js';

interface BugReportDialogProps {
  open: boolean;
  onClose: () => void;
  screenshot: string | null;
}

interface ReportBugSuccess {
  url: string;
  number: number;
}

export function BugReportDialog({ open, onClose, screenshot }: BugReportDialogProps) {
  const [title, setTitle] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [attachScreenshot, setAttachScreenshot] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<ReportBugSuccess | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Reset transient state whenever the dialog is (re-)opened.
  React.useEffect(() => {
    if (open) {
      setTitle('');
      setMessage('');
      setAttachScreenshot(true);
      setSubmitting(false);
      setResult(null);
      setError(null);
    }
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim() || submitting) return;

    const sessionId = useStore.getState().activeSessionId;
    if (!sessionId) {
      setError('No active session');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/report-bug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title,
          message,
          sessionId,
          screenshot: attachScreenshot && screenshot ? screenshot : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(body as ReportBugSuccess);
      } else {
        setError((body as { error?: string }).error ?? 'Failed to file bug report');
      }
    } catch {
      setError('Failed to file bug report');
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = submitting || !title.trim() || !message.trim();

  return (
    <Dialog open={open} onClose={handleClose} title="Report a bug">
      {result ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-foreground">
            Thanks — issue #{result.number} was filed.
          </p>
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="text-agent hover:underline"
          >
            View issue
          </a>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={handleClose}>Close</Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="bug-title">Title</label>
            <Input
              id="bug-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary of the bug"
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="bug-message">What happened?</label>
            <Textarea
              id="bug-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe what you did and what went wrong"
              rows={4}
              disabled={submitting}
            />
          </div>

          {screenshot ? (
            <div className="flex flex-col gap-2">
              <img src={screenshot} className="max-h-40 rounded-lg border border-border" alt="Screenshot preview" />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={attachScreenshot}
                  onChange={(e) => setAttachScreenshot(e.target.checked)}
                  disabled={submitting}
                />
                Attach this screenshot
              </label>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Screenshot unavailable</p>
          )}

          <p className="text-xs text-muted-foreground">The full session trace will be attached.</p>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={submitting} disabled={disabled}>
              Submit
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
