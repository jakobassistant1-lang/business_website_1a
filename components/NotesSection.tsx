"use client";

// The "Your notes" tab on /study/[canvasId]. Students upload their own notes for
// ONE test; the extracted text is stored (text-only) and PINNED into study-guide
// and practice-question generation ahead of Canvas material (see lib/study.ts).
// Adding/deleting a note marks the guide/practice as stale (onNotesChanged) so the
// student is prompted to regenerate — generation is cached and won't auto-refresh.

import { useCallback, useEffect, useRef, useState } from "react";

type NoteSourceKind = "paste" | "pdf" | "docx" | "text" | "image";
interface StudentNote {
  id: number;
  title: string;
  sourceKind: NoteSourceKind;
  charCount: number;
  imageCount: number;
  text: string;
  createdAt: string;
}

const BADGE: Record<NoteSourceKind, string> = {
  paste: "Pasted text",
  pdf: "File · PDF",
  docx: "File · Word",
  text: "File · Text",
  image: "Photo notes",
};

const ERROR_TEXT: Record<string, string> = {
  unsupported: "That file type isn't supported. Use a PDF, Word doc, or text file.",
  too_large: "That file is over 10 MB. Try a smaller file, or paste the text instead.",
  empty: "We couldn't pull readable text from that file. Try pasting the text instead.",
  scanned_pdf: "This PDF looks like scanned images with no selectable text. Add it as photos instead, or paste the text.",
  error: "Something went wrong reading that file. Try again, or paste the text.",
  limit_reached: "You've reached the max number of notes for this test. Delete one to add another.",
  network: "Couldn't reach the server. Try again.",
  unauthorized: "Please sign in again.",
  not_found: "Couldn't find this test.",
  bad_request: "Something was off with that upload.",
};
const errText = (code: unknown) => (typeof code === "string" && ERROR_TEXT[code]) || ERROR_TEXT.error;

const FILE_ACCEPT =
  ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

const approxWords = (chars: number) => `~${Math.max(1, Math.round(chars / 5)).toLocaleString()} words`;

export function NotesSection({
  canvasId,
  onNotesChanged,
  onCountChange,
}: {
  canvasId: number;
  onNotesChanged: () => void; // a note was added/deleted → guide/practice now stale
  onCountChange: (n: number) => void; // keep the tab's count badge in sync
}) {
  const [notes, setNotes] = useState<StudentNote[] | null>(null); // null = loading
  const [limit, setLimit] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes?canvasId=${canvasId}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok) {
        setNotes(json.notes);
        onCountChange(json.notes.length);
        if (typeof json.limit === "number") setLimit(json.limit);
      } else {
        setNotes([]);
      }
    } catch {
      setNotes([]);
    }
  }, [canvasId, onCountChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const atLimit = !!notes && notes.length >= limit;

  async function uploadFiles(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files)) {
      if (notes && notes.length >= limit) {
        setError(ERROR_TEXT.limit_reached);
        break;
      }
      setBusy(true);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("canvasId", String(canvasId));
        const res = await fetch("/api/notes/file", { method: "POST", body: form });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.ok) {
          await refresh();
          onNotesChanged();
        } else {
          setError(errText(json?.error));
        }
      } catch {
        setError(ERROR_TEXT.network);
      } finally {
        setBusy(false);
      }
    }
  }

  // Shared by paste and (in Phase 2) reviewed photo transcriptions.
  async function submitNote(payload: { title: string; text: string; sourceKind?: string; imageCount?: number }, onDone: () => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasId, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok) {
        onDone();
        await refresh();
        onNotesChanged();
      } else {
        setError(errText(json?.error));
      }
    } catch {
      setError(ERROR_TEXT.network);
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: number, title: string) {
    // Renaming doesn't change content → no onNotesChanged (guide stays fresh).
    const res = await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) await refresh();
  }

  async function remove(id: number) {
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (res.ok) {
      await refresh();
      onNotesChanged();
    }
  }

  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-ink">Your notes</h2>
      <p className="mt-1 text-sm text-muted">
        Add your own notes for this test. They&apos;re <span className="font-medium text-ink">always used</span> when Navo builds your
        study guide and practice questions — and they come first, ahead of Canvas material.
      </p>

      {notes === null ? (
        <p className="mt-4 text-sm text-muted">Loading…</p>
      ) : notes.length === 0 ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
          }}
          className={`mt-4 rounded-xl border-2 border-dashed p-8 text-center transition ${
            dragOver ? "border-accent bg-accent-soft/40" : "border-line"
          }`}
        >
          <p className="text-base font-medium text-ink">{busy ? "Reading your file…" : dragOver ? "Drop to upload" : "No notes yet."}</p>
          <p className="mt-1 text-sm text-muted">Upload a file, paste from Notion or Docs, or snap a photo of handwritten notes.</p>
          <div className="mt-4 flex flex-col justify-center gap-2.5 sm:flex-row">
            <button onClick={() => fileInputRef.current?.click()} disabled={busy} className="btn-primary text-sm">
              Upload file
            </button>
            <button onClick={() => setShowPaste(true)} disabled={busy} className="btn-ghost text-sm">
              Paste text
            </button>
            <button onClick={() => setShowPhoto(true)} disabled={busy} className="btn-ghost text-sm">
              Add photos
            </button>
          </div>
          <p className="mt-3 text-[11px] text-muted">PDF, Word, or text · up to 10 MB · {limit} notes per test.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-[14px] bg-accent-soft px-4 py-2.5 text-[13px] font-medium text-accent">
            <span className="font-semibold">Pinned</span> — {notes.length === 1 ? "this note is" : `these ${notes.length} notes are`} always
            included first, ahead of Canvas material.
          </div>
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} onRename={rename} onDelete={remove} />
          ))}
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <button onClick={() => fileInputRef.current?.click()} disabled={busy || atLimit} className="btn-ghost text-sm">
              {busy ? "Working…" : "+ Upload file"}
            </button>
            <button onClick={() => setShowPaste(true)} disabled={busy || atLimit} className="btn-ghost text-sm">
              + Paste text
            </button>
            <button onClick={() => setShowPhoto(true)} disabled={busy || atLimit} className="btn-ghost text-sm">
              + Add photos
            </button>
          </div>
          {atLimit && (
            <p className="text-[11px] text-muted">You&apos;ve reached the max of {limit} notes for this test. Delete one to add another.</p>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-[14px] border border-danger/30 bg-danger-soft/40 px-4 py-3" role="alert">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {showPaste && <PasteModal busy={busy} onClose={() => setShowPaste(false)} onSave={(title, text) => void submitNote({ title, text }, () => setShowPaste(false))} />}
      {showPhoto && (
        <PhotoModal
          canvasId={canvasId}
          busy={busy}
          onClose={() => setShowPhoto(false)}
          onSave={(title, text, imageCount) => void submitNote({ title, text, sourceKind: "image", imageCount }, () => setShowPhoto(false))}
        />
      )}
    </section>
  );
}

function NoteRow({
  note,
  onRename,
  onDelete,
}: {
  note: StudentNote;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showText, setShowText] = useState(false);

  return (
    <div className="rounded-[14px] border border-line-subtle bg-surface-soft/50 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const t = title.trim();
                if (t) {
                  onRename(note.id, t);
                  setEditing(false);
                }
              }}
              className="flex gap-2"
            >
              <input autoFocus className="field flex-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="Note title" />
              <button type="submit" className="btn-primary text-sm">
                Save
              </button>
            </form>
          ) : (
            <p className="truncate text-sm font-medium text-ink">{note.title}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              {BADGE[note.sourceKind]}
              {note.sourceKind === "image" && note.imageCount ? ` · ${note.imageCount} images` : ""}
            </span>
            <span className="text-[11px] text-muted">{approxWords(note.charCount)}</span>
            <button onClick={() => setShowText((v) => !v)} className="text-[11px] font-medium text-muted hover:text-accent">
              {showText ? "Hide text" : "View extracted text"}
            </button>
          </div>
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={() => {
                setTitle(note.title);
                setEditing(true);
              }}
              className="text-[13px] font-medium text-muted transition-colors hover:text-accent"
            >
              Rename
            </button>
            {confirmDel ? (
              <span className="flex items-center gap-2 text-[13px]">
                <button onClick={() => onDelete(note.id)} className="font-medium text-danger hover:underline">
                  Delete
                </button>
                <button onClick={() => setConfirmDel(false)} className="text-muted hover:text-ink">
                  Cancel
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirmDel(true)} className="text-[13px] font-medium text-muted transition-colors hover:text-danger">
                Delete
              </button>
            )}
          </div>
        )}
      </div>
      {showText && (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-[13px] leading-relaxed text-muted">
          {note.text}
        </pre>
      )}
    </div>
  );
}

function PasteModal({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (title: string, text: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgb(22 22 25 / 0.55)" }}
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="paste-notes-title"
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl border border-line-subtle bg-surface p-6 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="paste-notes-title" className="text-lg font-semibold text-ink">
          Paste your notes
        </h2>
        <p className="mt-1 text-[13px] text-muted">Copy from Notion, Google Docs, or anywhere — formatting is dropped; we keep the text.</p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onSave(title.trim() || "Pasted notes", text.trim());
          }}
        >
          <div>
            <label className="label" htmlFor="note-title">
              Title
            </label>
            <input
              id="note-title"
              ref={titleRef}
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Chapter 7 summary"
              maxLength={120}
            />
          </div>
          <div>
            <label className="label" htmlFor="note-text">
              Notes
            </label>
            <textarea
              id="note-text"
              className="field"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={20000}
              placeholder="Paste your notes here…"
            />
            <p className="mt-1 text-right text-[11px] text-muted">{text.length.toLocaleString()} / 20,000</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm">
              Cancel
            </button>
            <button type="submit" disabled={!text.trim() || busy} className="btn-primary text-sm">
              {busy ? "Saving…" : "Save note"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const TRANSCRIBE_ERR: Record<string, string> = {
  no_key: "The AI service isn't configured.",
  timeout: "Transcription took too long. Try fewer or clearer photos.",
  http_error: "AI couldn't read those images. Make sure the writing is in focus and well-lit, then try again.",
  empty: "We couldn't read any text from those photos. Try clearer, well-lit images.",
  unsupported_image: "Use JPEG, PNG, WEBP, or HEIC images.",
  too_large: "One of those images is over 10 MB.",
  too_many_images: "You can add up to 10 images per note.",
  network: "Couldn't reach the server. Try again.",
  not_found: "Couldn't find this test.",
  bad_request: "Choose at least one image first.",
  error: "Something went wrong. Try again.",
};
const transcribeErr = (code: unknown) => (typeof code === "string" && TRANSCRIBE_ERR[code]) || TRANSCRIBE_ERR.error;

// Photo → handwriting transcription. Select images → "Transcribe with AI" (Gemini
// vision) → REVIEW/edit the text (OCR can err) → save via the parent's submitNote.
function PhotoModal({
  canvasId,
  busy,
  onClose,
  onSave,
}: {
  canvasId: number;
  busy: boolean;
  onClose: () => void;
  onSave: (title: string, text: string, imageCount: number) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [step, setStep] = useState<"select" | "transcribing" | "review">("select");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("Handwritten notes");
  const [err, setErr] = useState<string | null>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setErr(null);
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 10));
  }

  async function transcribe() {
    if (files.length === 0) return;
    setStep("transcribing");
    setErr(null);
    try {
      const form = new FormData();
      form.append("canvasId", String(canvasId));
      files.forEach((f) => form.append("images", f));
      const res = await fetch("/api/notes/transcribe", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok) {
        setText(json.text || "");
        setStep("review");
      } else {
        setErr(transcribeErr(json?.error));
        setStep("select");
      }
    } catch {
      setErr(TRANSCRIBE_ERR.network);
      setStep("select");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgb(22 22 25 / 0.55)" }}
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-notes-title"
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl border border-line-subtle bg-surface p-6 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="photo-notes-title" className="text-lg font-semibold text-ink">
          Add photos of handwritten notes
        </h2>
        <p className="mt-1 text-[13px] text-muted">We&apos;ll read your handwriting with AI — you can review and fix the text before saving.</p>

        {previews.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {previews.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt={`Page ${i + 1}`} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
            ))}
          </div>
        )}

        {step === "review" ? (
          <div className="mt-4 space-y-3">
            <div>
              <label className="label" htmlFor="photo-title">
                Title
              </label>
              <input id="photo-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </div>
            <div>
              <label className="label" htmlFor="photo-text">
                Transcription — check it before saving
              </label>
              <textarea id="photo-text" className="field" rows={12} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} />
              <p className="mt-1 text-[11px] text-muted">AI can misread handwriting. Fix anything that looks off.</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setStep("select")} className="text-[13px] font-medium text-muted transition-colors hover:text-accent">
                ← Back to photos
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="btn-ghost text-sm">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!text.trim() || busy}
                  onClick={() => onSave(title.trim() || "Handwritten notes", text.trim(), files.length)}
                  className="btn-primary text-sm"
                >
                  {busy ? "Saving…" : "Save note"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {step === "transcribing" ? (
              <div className="rounded-[14px] bg-accent-soft px-4 py-3 text-sm text-accent" aria-live="polite">
                Reading your handwriting with AI… this can take ~10–25 seconds.
              </div>
            ) : (
              <button onClick={() => imgInputRef.current?.click()} className="btn-ghost text-sm">
                {files.length > 0 ? "Add more photos" : "Choose photos"}
              </button>
            )}
            {err && (
              <p className="text-sm text-danger" role="alert">
                {err}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn-ghost text-sm">
                Cancel
              </button>
              <button type="button" disabled={files.length === 0 || step === "transcribing"} onClick={transcribe} className="btn-primary text-sm">
                {step === "transcribing" ? "Transcribing…" : "Transcribe with AI"}
              </button>
            </div>
          </div>
        )}

        <input
          ref={imgInputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
