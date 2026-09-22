/**
 * Shapes returned by the employee-facing onboarding endpoints. Extracted from
 * StartHere.tsx so the Home page and the Tasks page describe the same payload
 * once instead of twice.
 *
 * completion_mode is deliberately absent: migration 0028 removed 'dual' and
 * 'owner', so every task is closed by the employee alone and any branch on it
 * would be dead code.
 */

export interface TaskRow {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  due_date: string;
  priority?: string;
  is_required?: boolean;
  is_checkpoint: boolean;
  blocked_reason?: string | null;
  bucket?: 'overdue' | 'today' | 'upcoming';
  is_overdue?: boolean;
  /** 'document_upload' marks the gating task whose popup shows the requested
   *  documents instead of a generic checklist. */
  system_key?: string | null;
  subtask_count?: number;
  subtask_completed_count?: number;
}

/**
 * One entry from /onboardings/me's `steps`. This is the ONLY payload that
 * includes locked and completed tasks — the bucketed today/upcoming/overdue
 * arrays exclude them — so the roadmap renders from here.
 *
 * Fields beyond the original five are optional so the frontend still compiles
 * and degrades gracefully against an older backend.
 */
export interface StepRow {
  id: string;
  title: string;
  status: string;
  due_date: string;
  is_checkpoint: boolean;
  description?: string | null;
  system_key?: string | null;
  priority?: string;
  blocked_reason?: string | null;
  subtask_count?: number;
  subtask_completed_count?: number;
}

export interface SubtaskRow {
  id: string;
  title: string;
  description: string | null;
  display_order: number;
  is_required: boolean;
  completed_at: string | null;
}

export interface JoineeDocumentRow {
  requirement_id: string;
  status: 'awaiting_upload' | 'submitted' | 'approved' | 'rejected';
  label: string;
  upload_id: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: string | null;
  uploaded_at: string | null;
  review_status: 'pending_review' | 'approved' | 'rejected' | null;
  review_note: string | null;
}

export interface DashboardResponse {
  onboarding: {
    id: string;
    status: string;
    start_date: string;
  };
  today: TaskRow[];
  upcoming: TaskRow[];
  overdue: TaskRow[];
  steps: StepRow[];
  progress: { requiredTotal: number; requiredCompleted: number; percent: number };
}
