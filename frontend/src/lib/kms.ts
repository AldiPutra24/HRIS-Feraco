import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/kms`;

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function extractError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.detail === 'string') return d.detail;
  for (const key of Object.keys(d)) {
    const v = d[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      const first = v.find((x) => typeof x === 'string');
      if (first) return first;
    }
  }
  return null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const csrf = getCookie('csrftoken');
  const method = (init.method ?? 'GET').toUpperCase();
  if (csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('X-CSRFToken', csrf);
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(extractError(data) || `API error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KmsStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export const KMS_STATUS_LABELS: Record<KmsStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Terbit',
  ARCHIVED: 'Arsip',
};

export type KmsCategory = {
  id: number;
  name: string;
  description: string;
  parent: number | null;
  parent_name: string | null;
  is_active: boolean;
  article_count: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type KmsCategoryNode = {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  children: Array<{
    id: number;
    name: string;
    is_active: boolean;
    article_count: number;
  }>;
};

export type KmsArticle = {
  id: number;
  title: string;
  summary: string;
  content: string;
  category: number;
  category_name: string;
  subcategory: number | null;
  subcategory_name: string | null;
  status: KmsStatus;
  has_attachment: boolean;
  attachment_name: string | null;
  attachment_content_type: string | null;
  attachment_size: number | null;
  view_count: number;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type KmsArticleInput = {
  title: string;
  summary: string;
  content: string;
  category: number;
  subcategory?: number | null;
  status: KmsStatus;
};

export type KmsPage<T> = { count: number; next: string | null; previous: string | null; results: T[] };

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function listKmsCategories(): Promise<KmsCategory[]> {
  return request<KmsCategory[]>('/categories/');
}

export function getKmsCategoryTree(): Promise<KmsCategoryNode[]> {
  return request<KmsCategoryNode[]>('/categories/tree/');
}

export function createKmsCategory(
  input: { name: string; description?: string; parent?: number | null; is_active?: boolean },
): Promise<KmsCategory> {
  return request<KmsCategory>('/categories/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateKmsCategory(
  id: number,
  input: Partial<{ name: string; description: string; parent: number | null; is_active: boolean }>,
): Promise<KmsCategory> {
  return request<KmsCategory>(`/categories/${id}/`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteKmsCategory(id: number): Promise<void> {
  return request<void>(`/categories/${id}/`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

export type KmsArticleFilters = {
  category?: number;
  subcategory?: number;
  status?: KmsStatus;
  search?: string;
  page?: number;
  ordering?: string;
};

export function listKmsArticles(filters: KmsArticleFilters = {}): Promise<KmsPage<KmsArticle>> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const suffix = q.toString();
  return request<KmsPage<KmsArticle>>(`/articles/${suffix ? `?${suffix}` : ''}`);
}

export function getKmsArticle(id: number): Promise<KmsArticle> {
  return request<KmsArticle>(`/articles/${id}/`);
}

export function createKmsArticle(input: KmsArticleInput): Promise<KmsArticle> {
  return request<KmsArticle>('/articles/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateKmsArticle(id: number, input: Partial<KmsArticleInput>): Promise<KmsArticle> {
  return request<KmsArticle>(`/articles/${id}/`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function archiveKmsArticle(id: number): Promise<KmsArticle> {
  return request<KmsArticle>(`/articles/${id}/archive/`, { method: 'POST' });
}

export function restoreKmsArticle(id: number): Promise<KmsArticle> {
  return request<KmsArticle>(`/articles/${id}/restore/`, { method: 'POST' });
}

export function deleteKmsArticle(id: number): Promise<void> {
  return request<void>(`/articles/${id}/`, { method: 'DELETE' });
}

export function listRelatedKmsArticles(id: number): Promise<KmsArticle[]> {
  return request<KmsArticle[]>(`/articles/${id}/related/`);
}

export async function uploadKmsAttachment(id: number, file: File): Promise<KmsArticle> {
  const form = new FormData();
  form.append('file', file);
  return request<KmsArticle>(`/articles/${id}/attachment/`, {
    method: 'POST',
    body: form,
  });
}

export function getKmsAttachmentUrl(id: number): Promise<{ url: string }> {
  return request<{ url: string }>(`/articles/${id}/attachment-url/`);
}
