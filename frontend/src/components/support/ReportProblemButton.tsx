import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";

import { apiClient, errorMessage } from "@/lib/apiClient";
import { supabase } from "@/lib/supabaseClient";
import type { SupportCategory, SupportTicket } from "@/lib/types";
import { Button, ErrorBanner, FieldLabel } from "@/components/ui";

const CATEGORIES: SupportCategory[] = ["bug", "ux_issue", "performance", "data_issue", "feature_request", "question", "other"];
const SEVERITIES = ["low", "medium", "high", "critical"] as const;

// Floating, mounted once in AppLayout (not per-page) so it's reachable from
// anywhere -- page URL and browser info are captured invisibly at submit
// time rather than asked for, since the reporter shouldn't have to think
// about that.
export function ReportProblemButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<SupportCategory>("bug");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("medium");
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      let screenshot_path: string | null = null;

      if (includeScreenshot) {
        setCapturing(true);
        try {
          const { default: html2canvas } = await import("html2canvas");
          const canvas = await html2canvas(document.body, { backgroundColor: "#0b1220", scale: 1 });
          const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          if (blob) {
            const {
              data: { user },
            } = await supabase.auth.getUser();
            if (user) {
              const path = `${user.id}/${Date.now()}.png`;
              const { error } = await supabase.storage.from("support-screenshots").upload(path, blob, { contentType: "image/png" });
              if (!error) screenshot_path = path;
            }
          }
        } finally {
          setCapturing(false);
        }
      }

      return apiClient.post<SupportTicket>("/support-tickets", {
        title,
        description,
        category,
        severity,
        page_url: window.location.href,
        user_agent: navigator.userAgent,
        screenshot_path,
      });
    },
    onSuccess: () => {
      setSubmitted(true);
      setTitle("");
      setDescription("");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    submit.mutate();
  }

  function handleClose() {
    setOpen(false);
    setSubmitted(false);
    submit.reset();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 rounded-edge-sm bg-danger px-3 py-2 text-xs font-medium text-white shadow-edge-sm hover:bg-danger/90"
      >
        Report Problem
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-edge-lg bg-surface p-4 shadow-edge-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">Report a problem</h2>
              <button onClick={handleClose} className="text-text-dim hover:text-text">
                ✕
              </button>
            </div>

            {submitted ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-text">
                  Thanks -- your report has been submitted and the Super Admin has been notified.
                </p>
                <Button onClick={handleClose} className="self-start">
                  Close
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <div>
                  <FieldLabel>Title</FieldLabel>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Short summary"
                    className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
                  />
                </div>
                <div>
                  <FieldLabel>What happened?</FieldLabel>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <FieldLabel>Category</FieldLabel>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as SupportCategory)}
                      className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel>Severity</FieldLabel>
                    <select
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}
                      className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                    >
                      {SEVERITIES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-text-muted">
                  <input type="checkbox" checked={includeScreenshot} onChange={(e) => setIncludeScreenshot(e.target.checked)} />
                  Include a screenshot of this page
                </label>
                <Button type="submit" disabled={submit.isPending || capturing} className="mt-1 self-start">
                  {capturing ? "Capturing screenshot..." : submit.isPending ? "Submitting..." : "Submit report"}
                </Button>
                {submit.isError && <ErrorBanner message={errorMessage(submit.error)} />}
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
