import * as Prim from '../../elements/primitives/index.js';
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
        <Prim.Col className="gap-3 text-sm" style={{ lineHeight: '1.25rem' }}>
          <Prim.Text as="p" className="text-foreground">
            Thanks — issue #{result.number} was filed.
          </Prim.Text>
          <Prim.Link
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="text-agent hover:underline"
          >
            View issue
          </Prim.Link>
          <Prim.Row className="justify-end">
            <Button variant="outline" size="sm" onClick={handleClose}>Close</Button>
          </Prim.Row>
        </Prim.Col>
      ) : (
        <Prim.Form className="flex-col gap-3" display="flex" onSubmit={handleSubmit}>
          <Prim.Col className="gap-1">
            <Prim.Text as="label" className="text-xs text-muted-foreground" htmlFor="bug-title">Title</Prim.Text>
            <Input
              id="bug-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary of the bug"
              disabled={submitting}
            />
          </Prim.Col>
          <Prim.Col className="gap-1">
            <Prim.Text as="label" className="text-xs text-muted-foreground" htmlFor="bug-message">What happened?</Prim.Text>
            <Textarea
              id="bug-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe what you did and what went wrong"
              rows={4}
              disabled={submitting}
            />
          </Prim.Col>

          {screenshot ? (
            <Prim.Col className="gap-2">
              <Prim.Image src={screenshot} className="max-h-40 rounded-lg border border-border" alt="Screenshot preview" />
              <Prim.Text as="label" className="items-center gap-2 text-xs text-muted-foreground" display="flex">
                <Prim.TextField
                  type="checkbox"
                  checked={attachScreenshot}
                  onChange={(e) => setAttachScreenshot(e.target.checked)}
                  disabled={submitting}
                />
                Attach this screenshot
              </Prim.Text>
            </Prim.Col>
          ) : (
            <Prim.Text as="p" className="text-xs text-muted-foreground">Screenshot unavailable</Prim.Text>
          )}

          <Prim.Text as="p" className="text-xs text-muted-foreground">The full session trace will be attached.</Prim.Text>

          {error && <Prim.Text as="p" className="text-xs text-destructive">{error}</Prim.Text>}

          <Prim.Row className="justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={submitting} disabled={disabled}>
              Submit
            </Button>
          </Prim.Row>
        </Prim.Form>
      )}
    </Dialog>
  );
}
