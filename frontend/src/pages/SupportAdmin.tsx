import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { Employee, SupportTicket, SupportTicketNote, SupportTicketStatus } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingState, Table, TableEmptyRow, TableHead, Td, Th, Tr } from "@/components/ui";

const STATUSES: SupportTicketStatus[] = ["new", "acknowledged", "in_progress", "resolved", "closed"];

const STATUS_STYLES: Record<SupportTicketStatus, string> = {
  new: "bg-warning-soft text-warning",
  acknowledged: "bg-info-soft text-info",
  in_progress: "bg-success-soft text-success",
  resolved: "bg-success-soft text-success",
  closed: "bg-surface2 text-text-dim",
};

const SEVERITY_STYLES: Record<string, string> = {
  low: "bg-surface2 text-text-muted",
  medium: "bg-info-soft text-info",
  high: "bg-warning-soft text-warning",
  critical: "bg-danger/10 text-danger",
};

function employeeName(employees: Employee[] | undefined, id: string): string {
  const emp = employees?.find((e) => e.id === id);
  return emp ? `${emp.first_name} ${emp.last_name}` : id;
}

export default function SupportAdmin() {
  const queryClient = useQueryClient();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [noteText, setNoteText] = useState("");

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => apiClient.get<Employee[]>("/employees") });

  const ticketsQuery = useQuery({
    queryKey: ["support-tickets", statusFilter],
    queryFn: () => apiClient.get<SupportTicket[]>(`/support-tickets${statusFilter ? `?status=${statusFilter}` : ""}`),
  });

  const selectedTicket = ticketsQuery.data?.find((t) => t.id === selectedTicketId) ?? null;

  const screenshotUrlQuery = useQuery({
    queryKey: ["support-ticket-screenshot", selectedTicketId],
    queryFn: () => apiClient.get<string | null>(`/support-tickets/${selectedTicketId}/screenshot-url`),
    enabled: !!selectedTicket?.screenshot_path,
  });

  const notesQuery = useQuery({
    queryKey: ["support-ticket-notes", selectedTicketId],
    queryFn: () => apiClient.get<SupportTicketNote[]>(`/support-tickets/${selectedTicketId}/notes`),
    enabled: !!selectedTicketId,
  });

  const updateTicket = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      apiClient.patch<SupportTicket>(`/support-tickets/${id}`, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["support-tickets"] }),
  });

  const addNote = useMutation({
    mutationFn: (note: string) => apiClient.post<SupportTicketNote>(`/support-tickets/${selectedTicketId}/notes`, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-ticket-notes", selectedTicketId] });
      setNoteText("");
    },
  });

  function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    addNote.mutate(noteText.trim());
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Support Center</h1>
          <p className="mt-1 text-sm text-text-muted">Reported problems, visible to Super Admins only.</p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Table>
            <TableHead>
              <Th>Title</Th>
              <Th>Reported by</Th>
              <Th>Severity</Th>
              <Th>Status</Th>
            </TableHead>
            <tbody>
              {ticketsQuery.isLoading && (
                <tr>
                  <td colSpan={4}>
                    <LoadingState label="Loading tickets..." />
                  </td>
                </tr>
              )}
              {(ticketsQuery.data ?? []).map((ticket) => (
                <Tr key={ticket.id} onClick={() => setSelectedTicketId(ticket.id)} selected={selectedTicketId === ticket.id}>
                  <Td className="text-text">{ticket.title}</Td>
                  <Td className="text-text-muted">{employeeName(employeesQuery.data, ticket.reported_by)}</Td>
                  <Td>
                    <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[ticket.severity]}`}>
                      {ticket.severity}
                    </span>
                  </Td>
                  <Td>
                    <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[ticket.status]}`}>
                      {ticket.status.replace("_", " ")}
                    </span>
                  </Td>
                </Tr>
              ))}
              {ticketsQuery.data?.length === 0 && <TableEmptyRow colSpan={4} message="No tickets." />}
            </tbody>
          </Table>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Details</h2>
          {!selectedTicket ? (
            <EmptyState message="Select a ticket to see details." />
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-base font-medium text-text">{selectedTicket.title}</p>
                <p className="mt-1 text-sm text-text-muted">{selectedTicket.description}</p>
              </div>

              <div className="border-t border-border pt-3 text-xs text-text-dim">
                <p>Reported by {employeeName(employeesQuery.data, selectedTicket.reported_by)}</p>
                <p>Category: {selectedTicket.category.replace("_", " ")}</p>
                {selectedTicket.page_url && <p className="truncate">Page: {selectedTicket.page_url}</p>}
                {selectedTicket.user_agent && <p className="truncate">Browser: {selectedTicket.user_agent}</p>}
                <p>{new Date(selectedTicket.created_at).toLocaleString()}</p>
              </div>

              {selectedTicket.screenshot_path && (
                <div className="border-t border-border pt-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Screenshot</p>
                  {screenshotUrlQuery.isLoading && <LoadingState label="Loading..." />}
                  {screenshotUrlQuery.data && (
                    <a href={screenshotUrlQuery.data} target="_blank" rel="noreferrer">
                      <img src={screenshotUrlQuery.data} alt="Reported screenshot" className="rounded-edge-sm border border-border" />
                    </a>
                  )}
                </div>
              )}

              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Status</p>
                <select
                  value={selectedTicket.status}
                  onChange={(e) => updateTicket.mutate({ id: selectedTicket.id, status: e.target.value })}
                  className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                {updateTicket.isError && <ErrorBanner message={errorMessage(updateTicket.error)} />}
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Internal notes</p>
                <ul className="flex flex-col gap-1.5">
                  {(notesQuery.data ?? []).map((note) => (
                    <li key={note.id} className="rounded-edge-sm bg-surface2 p-2 text-sm text-text">
                      <p>{note.note}</p>
                      <p className="mt-1 text-[11px] text-text-dim">
                        {employeeName(employeesQuery.data, note.employee_id)} &middot; {new Date(note.created_at).toLocaleString()}
                      </p>
                    </li>
                  ))}
                  {notesQuery.data?.length === 0 && <li className="text-sm text-text-dim">No notes yet.</li>}
                </ul>
                <form onSubmit={handleAddNote} className="mt-2 flex gap-2">
                  <input
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add an internal note..."
                    className="flex-1 rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
                  />
                  <Button type="submit" size="sm" disabled={addNote.isPending}>
                    {addNote.isPending ? "Adding..." : "Add"}
                  </Button>
                </form>
                {addNote.isError && <ErrorBanner message={errorMessage(addNote.error)} />}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
