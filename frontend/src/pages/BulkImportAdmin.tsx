import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { Company, FieldStrategy, ImportBatch, ImportBatchRow, ImportMode, ImportRowAction } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, FieldLabel, LoadingState, Table, TableEmptyRow, TableHead, Td, Th, Tr } from "@/components/ui";

const IMPORT_MODE_LABELS: Record<ImportMode, string> = {
  insert_only: "Insert New Only",
  upsert: "Insert + Update Existing (default)",
  update_only: "Update Existing Only",
  skip_duplicates: "Skip Duplicates",
};

const FIELD_STRATEGY_LABELS: Record<FieldStrategy, string> = {
  non_empty_only: "Update only non-empty values (default)",
  overwrite_all: "Overwrite all fields",
};

const STATUS_STYLES: Record<ImportBatch["status"], string> = {
  staged: "bg-surface2 text-text-muted",
  previewed: "bg-warning-soft text-warning",
  committed: "bg-success-soft text-success",
  failed: "bg-danger/10 text-danger",
  rolled_back: "bg-surface2 text-text-dim",
};

const ACTION_STYLES: Record<ImportRowAction, string> = {
  insert: "bg-success-soft text-success",
  update: "bg-success-soft text-success",
  skip: "bg-surface2 text-text-muted",
  reject: "bg-danger/10 text-danger",
};

// Employees-only in Phase 1 -- new modules are a config entry in the
// backend's IMPORT_MODULE_REGISTRY, not a frontend change, once each has
// its own business-identifier column via its own migration.
const MODULES = [{ value: "employees", label: "Employees" }];

export default function BulkImportAdmin() {
  const queryClient = useQueryClient();
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [rowFilter, setRowFilter] = useState<ImportRowAction | "all">("all");

  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const batchesQuery = useQuery({ queryKey: ["import-batches"], queryFn: () => apiClient.get<ImportBatch[]>("/import-batches") });

  // Fetched independently, not derived from batchesQuery.data.find(...) --
  // the history list and the currently-selected batch are two different
  // concerns, and deriving one from the other means a slow/failed/stale
  // list fetch silently blanks the preview panel even though the batch
  // itself uploaded and staged successfully (the mutation already has the
  // batch's id; there's no reason to wait on a second, unrelated query).
  const selectedBatchQuery = useQuery({
    queryKey: ["import-batch", selectedBatchId],
    queryFn: () => apiClient.get<ImportBatch>(`/import-batches/${selectedBatchId}`),
    enabled: !!selectedBatchId,
  });
  const selectedBatch = selectedBatchQuery.data ?? null;

  const rowsQuery = useQuery({
    queryKey: ["import-batch-rows", selectedBatchId, rowFilter],
    queryFn: () =>
      apiClient.get<ImportBatchRow[]>(`/import-batches/${selectedBatchId}/rows${rowFilter === "all" ? "" : `?action=${rowFilter}`}`),
    enabled: !!selectedBatchId,
  });

  const uploadBatch = useMutation({
    mutationFn: (form: FormData) => apiClient.postForm<ImportBatch>("/import-batches", form),
    onSuccess: (batch) => {
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      setSelectedBatchId(batch.id);
      setRowFilter("all");
    },
  });

  const commitBatch = useMutation({
    mutationFn: (batchId: string) => apiClient.post<ImportBatch>(`/import-batches/${batchId}/commit`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["import-batch", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["import-batch-rows", selectedBatchId] });
    },
  });

  const revalidateBatch = useMutation({
    mutationFn: (batchId: string) => apiClient.post<ImportBatchRow[]>(`/import-batches/${batchId}/revalidate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-batch-rows", selectedBatchId] });
    },
  });

  async function handleDownloadLog(batchId: string) {
    const blob = await apiClient.getBlob(`/import-batches/${batchId}/log`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-batch-${batchId}-log.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Bulk Import Center</h1>
        <p className="mt-1 text-sm text-text-muted">
          Upload a CSV, review what will change, then commit. Nothing is written until you commit.
        </p>
      </div>

      <UploadForm companies={companiesQuery.data ?? []} onSubmit={(form) => uploadBatch.mutate(form)} pending={uploadBatch.isPending} />
      {uploadBatch.isError && <ErrorBanner message={errorMessage(uploadBatch.error)} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Import History</h2>
          </div>
          <Table>
            <TableHead>
              <Th>File</Th>
              <Th>Status</Th>
            </TableHead>
            <tbody>
              {batchesQuery.isLoading && (
                <tr>
                  <td colSpan={2}>
                    <LoadingState label="Loading..." />
                  </td>
                </tr>
              )}
              {(batchesQuery.data ?? []).map((batch) => (
                <Tr
                  key={batch.id}
                  onClick={() => {
                    setSelectedBatchId(batch.id);
                    setRowFilter("all");
                  }}
                  selected={selectedBatchId === batch.id}
                >
                  <Td className="text-text">
                    <p className="truncate">{batch.file_name}</p>
                    <p className="text-xs text-text-dim">{new Date(batch.created_at).toLocaleString()}</p>
                  </Td>
                  <Td>
                    <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[batch.status]}`}>
                      {batch.status}
                    </span>
                  </Td>
                </Tr>
              ))}
              {batchesQuery.data?.length === 0 && <TableEmptyRow colSpan={2} message="No imports yet." />}
            </tbody>
          </Table>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Preview / Summary</h2>
          {selectedBatchId && selectedBatchQuery.isLoading ? (
            <LoadingState label="Loading..." />
          ) : !selectedBatch ? (
            <EmptyState message="Upload a file, or select a past import, to see details." />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <SummaryStat label="To insert / inserted" value={selectedBatch.inserted_count} />
                <SummaryStat label="To update / updated" value={selectedBatch.updated_count} />
                <SummaryStat label="Skipped" value={selectedBatch.skipped_count} />
                <SummaryStat label="Rejected" value={selectedBatch.rejected_count} />
                <SummaryStat label="Total rows" value={selectedBatch.row_count} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-text-dim">
                  {IMPORT_MODE_LABELS[selectedBatch.import_mode]} &middot; {FIELD_STRATEGY_LABELS[selectedBatch.field_strategy]}
                </p>
                <div className="ml-auto flex gap-2">
                  {selectedBatch.status === "previewed" && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => revalidateBatch.mutate(selectedBatch.id)}
                        disabled={revalidateBatch.isPending}
                        title="Re-check rejected rows against the current Org Chart, without re-uploading"
                      >
                        {revalidateBatch.isPending ? "Revalidating..." : "Revalidate"}
                      </Button>
                      <Button size="sm" onClick={() => commitBatch.mutate(selectedBatch.id)} disabled={commitBatch.isPending}>
                        {commitBatch.isPending ? "Committing..." : "Commit Import"}
                      </Button>
                    </>
                  )}
                  {selectedBatch.status === "committed" && (
                    <Button size="sm" variant="secondary" onClick={() => handleDownloadLog(selectedBatch.id)}>
                      Download log
                    </Button>
                  )}
                </div>
              </div>
              {commitBatch.isError && <ErrorBanner message={errorMessage(commitBatch.error)} />}
              {revalidateBatch.isError && <ErrorBanner message={errorMessage(revalidateBatch.error)} />}

              <div className="flex gap-1">
                {(["all", "insert", "update", "skip", "reject"] as const).map((f) => (
                  <Button key={f} variant="toolbar" size="sm" active={rowFilter === f} onClick={() => setRowFilter(f)}>
                    {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
                  </Button>
                ))}
              </div>

              <div className="max-h-[420px] overflow-y-auto rounded-edge-sm border border-border">
                <Table>
                  <TableHead className="sticky top-0 bg-surface">
                    <Th>Row</Th>
                    <Th>Matching key</Th>
                    <Th>Action</Th>
                    <Th>Notes</Th>
                  </TableHead>
                  <tbody>
                    {rowsQuery.isLoading && (
                      <tr>
                        <td colSpan={4}>
                          <LoadingState label="Loading rows..." />
                        </td>
                      </tr>
                    )}
                    {(rowsQuery.data ?? []).map((row) => (
                      <Tr key={row.id}>
                        <Td className="text-text-muted">{row.row_number}</Td>
                        <Td className="text-text">{row.matching_key_value ?? "—"}</Td>
                        <Td>
                          <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${ACTION_STYLES[row.action]}`}>
                            {row.action}
                          </span>
                        </Td>
                        <Td className="text-xs text-danger">{row.validation_errors?.join("; ") ?? ""}</Td>
                      </Tr>
                    ))}
                    {!rowsQuery.isLoading && rowsQuery.data?.length === 0 && <TableEmptyRow colSpan={4} message="No rows match this filter." />}
                  </tbody>
                </Table>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-text">{value}</p>
    </div>
  );
}

function UploadForm({
  companies,
  onSubmit,
  pending,
}: {
  companies: Company[];
  onSubmit: (form: FormData) => void;
  pending: boolean;
}) {
  const [module, setModule] = useState(MODULES[0].value);
  const [companyId, setCompanyId] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("upsert");
  const [fieldStrategy, setFieldStrategy] = useState<FieldStrategy>("non_empty_only");
  const [file, setFile] = useState<File | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file || !companyId) return;
    const form = new FormData();
    form.append("module", module);
    form.append("company_id", companyId);
    form.append("import_mode", importMode);
    form.append("field_strategy", fieldStrategy);
    form.append("file", file);
    onSubmit(form);
  }

  return (
    <Card className="p-4">
      <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div>
          <FieldLabel>Module</FieldLabel>
          <select
            value={module}
            onChange={(e) => setModule(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            {MODULES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>Company</FieldLabel>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            <option value="">Select...</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>Import mode</FieldLabel>
          <select
            value={importMode}
            onChange={(e) => setImportMode(e.target.value as ImportMode)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            {(Object.keys(IMPORT_MODE_LABELS) as ImportMode[]).map((m) => (
              <option key={m} value={m}>
                {IMPORT_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>On update</FieldLabel>
          <select
            value={fieldStrategy}
            onChange={(e) => setFieldStrategy(e.target.value as FieldStrategy)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            {(Object.keys(FIELD_STRATEGY_LABELS) as FieldStrategy[]).map((s) => (
              <option key={s} value={s}>
                {FIELD_STRATEGY_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>CSV file</FieldLabel>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text file:mr-2 file:rounded-edge-sm file:border-0 file:bg-surface3 file:px-2 file:py-1 file:text-xs"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={pending || !file || !companyId}>
          {pending ? "Uploading..." : "Upload & Preview"}
        </Button>
        <a
          href="/samples/employees-import-sample.csv"
          download
          className="text-xs text-edge-teal hover:underline"
        >
          Download sample CSV
        </a>
      </div>
      </form>
    </Card>
  );
}
