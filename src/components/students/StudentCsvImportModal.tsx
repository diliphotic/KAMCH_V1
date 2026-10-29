import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { FormField, Select } from '../ui/FormField';
import { AcademicBatch } from './studentTypes';

export interface StudentCsvImportModalProps {
  batches: AcademicBatch[];
  defaultBatchId: number | null;
  csrfToken: string | null;
  onClose: () => void;
  onImported: (message: string) => void;
}

interface PreviewRow {
  rowNumber: number;
  fullName: string;
  batchCode: string;
  batchName: string | null;
  admissionQuota: string;
  seatCategory: string | null;
  admissionYear: number;
  dateOfBirth: string | null;
  contactPhone: string | null;
  permanentUniversityNumber: string | null;
  temporaryRollAction: string;
  universityRegAction: string;
  errors: string[];
  warnings: string[];
}

interface PreviewState {
  canCommit: boolean;
  totalRows: number;
  validCount: number;
  errorCount: number;
  headerErrors: string[];
  rows: PreviewRow[];
}

export const StudentCsvImportModal: React.FC<StudentCsvImportModalProps> = ({
  batches,
  defaultBatchId,
  csrfToken,
  onClose,
  onImported,
}) => {
  const activeBatches = batches.filter((b) => b.isActive);
  const [selectedBatchId, setSelectedBatchId] = useState<string>(
    defaultBatchId && activeBatches.some((b) => b.id === defaultBatchId)
      ? String(defaultBatchId)
      : ''
  );
  const [csvContent, setCsvContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch('/api/students/import/template');
      if (!res.ok) throw new Error('Failed to download CSV template');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kamch_student_import_template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = typeof ev.target?.result === 'string' ? ev.target.result : '';
      setCsvContent(text);
    };
    reader.readAsText(file);
  };

  const handleRunPreview = async () => {
    if (!csvContent.trim()) {
      setErrorMsg('Select a CSV file or paste CSV rows before running validation preview.');
      return;
    }
    setErrorMsg(null);
    setIsPreviewing(true);
    try {
      const res = await fetch('/api/students/import/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          csvContent,
          defaultBatchId: selectedBatchId ? Number(selectedBatchId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'CSV preview validation failed');
      }
      setPreview(data);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleCommitImport = async () => {
    if (!preview?.canCommit) return;
    setErrorMsg(null);
    setIsCommitting(true);
    try {
      const res = await fetch('/api/students/import/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          csvContent,
          defaultBatchId: selectedBatchId ? Number(selectedBatchId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'CSV import transaction failed');
      }
      onImported(data.message);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-stone-900/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-4xl my-auto max-h-[92vh] flex flex-col">
        <CardHeader className="shrink-0">
          <div>
            <CardTitle>CSV Batch Student Import &amp; Validation Preview</CardTitle>
            <CardDescription>
              Preview validates every row before any database write. All-or-nothing atomic commit prevents partial imports; permanent university numbers are never fabricated.
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 cursor-pointer p-1"
            aria-label="Close CSV import modal"
          >
            <X className="w-4 h-4" />
          </button>
        </CardHeader>

        <CardContent className="overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="p-3.5 rounded-lg bg-[#FAF9F5] border border-stone-200 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="flex-1 max-w-sm">
              <FormField
                id="csv-default-batch"
                label="Fallback Batch (used when batch_code column is blank)"
              >
                <Select
                  id="csv-default-batch"
                  value={selectedBatchId}
                  onChange={(e) => {
                    setSelectedBatchId(e.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="">Require batch_code in every CSV row</option>
                  {activeBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code} · {b.admissionAcademicYear})
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<Download className="w-3.5 h-3.5" />}
                onClick={handleDownloadTemplate}
              >
                Download CSV Template
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Upload className="w-3.5 h-3.5" />}
                onClick={() => fileInputRef.current?.click()}
              >
                {fileName ? `File: ${fileName}` : 'Choose .CSV File'}
              </Button>
            </div>
          </div>

          <div>
            <label
              htmlFor="csv-paste-box"
              className="block text-xs font-semibold text-stone-700 mb-1"
            >
              CSV Content (Upload file above or paste CSV with header row)
            </label>
            <textarea
              id="csv-paste-box"
              rows={4}
              value={csvContent}
              onChange={(e) => {
                setCsvContent(e.target.value);
                setPreview(null);
              }}
              placeholder="batch_code,full_name,admission_quota,date_of_birth,contact_phone,father_name..."
              className="w-full p-2.5 text-xs font-mono bg-white border border-stone-300 rounded-md focus:border-[#4B2E2E] focus:outline-none"
            />
            <div className="flex justify-end mt-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                icon={<FileSpreadsheet className="w-3.5 h-3.5" />}
                isLoading={isPreviewing}
                onClick={handleRunPreview}
              >
                Validate &amp; Preview Rows
              </Button>
            </div>
          </div>

          {preview && (
            <div className="space-y-3 pt-2 border-t border-stone-200">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-stone-50 p-3 rounded-lg border border-stone-200 text-xs">
                <div className="flex flex-wrap items-center gap-4 tabular-nums">
                  <span>
                    Total Data Rows: <strong className="text-stone-900">{preview.totalRows}</strong>
                  </span>
                  <span className="text-emerald-800">
                    Valid Rows: <strong>{preview.validCount}</strong>
                  </span>
                  <span className={preview.errorCount > 0 ? 'text-rose-700 font-semibold' : 'text-stone-600'}>
                    Errors: <strong>{preview.errorCount}</strong>
                  </span>
                </div>
                <Badge variant={preview.canCommit ? 'success' : 'warning'} size="sm">
                  {preview.canCommit ? 'Ready for Atomic Commit' : 'Fix Errors Before Commit'}
                </Badge>
              </div>

              {preview.headerErrors.length > 0 && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-1">
                  {preview.headerErrors.map((he, i) => (
                    <div key={i}>• {he}</div>
                  ))}
                </div>
              )}

              {preview.rows.length > 0 && (
                <div className="overflow-x-auto border border-stone-200 rounded-lg max-h-64">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#FAF9F5] border-b border-stone-200 sticky top-0">
                      <tr className="text-[11px] font-semibold uppercase text-stone-600">
                        <th className="py-2 px-3">Row</th>
                        <th className="py-2 px-3">Student Name</th>
                        <th className="py-2 px-3">Batch &amp; Quota</th>
                        <th className="py-2 px-3">Identifier Handling</th>
                        <th className="py-2 px-3">Validation Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {preview.rows.map((r) => (
                        <tr
                          key={r.rowNumber}
                          className={r.errors.length > 0 ? 'bg-rose-50/40' : 'bg-white'}
                        >
                          <td className="py-2 px-3 font-mono tabular-nums text-stone-600">
                            #{r.rowNumber}
                          </td>
                          <td className="py-2 px-3 font-medium text-stone-900">
                            {r.fullName}
                            {r.dateOfBirth && (
                              <span className="block text-[11px] text-stone-500 font-normal tabular-nums">
                                DOB: {r.dateOfBirth}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <span className="font-medium text-stone-800">
                              {r.batchName || r.batchCode}
                            </span>
                            <span className="block text-[11px] text-stone-500">
                              {r.admissionQuota}
                              {r.seatCategory ? ` · ${r.seatCategory}` : ''}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-[11px] text-stone-600">
                            <div className="font-mono text-[#4B2E2E]">{r.temporaryRollAction}</div>
                            <div className="text-stone-500">{r.universityRegAction}</div>
                          </td>
                          <td className="py-2 px-3">
                            {r.errors.length > 0 ? (
                              <ul className="space-y-0.5 text-rose-800 text-[11px]">
                                {r.errors.map((er, i) => (
                                  <li key={i}>• {er}</li>
                                ))}
                              </ul>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-800 font-medium text-[11px]">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                Valid
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-stone-200">
            <span className="text-[11px] text-stone-500">
              Cancelling closes this preview immediately without writing any student records.
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel Without Importing
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!preview?.canCommit || isCommitting}
                isLoading={isCommitting}
                onClick={handleCommitImport}
              >
                Commit Verified Rows ({preview?.validCount || 0})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
