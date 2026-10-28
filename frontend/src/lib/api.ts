export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let refreshEnCours: Promise<boolean> | null = null;

async function rafraichir(): Promise<boolean> {
  if (!refreshEnCours) {
    refreshEnCours = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => { setTimeout(() => { refreshEnCours = null; }, 0); });
  }
  return refreshEnCours;
}

function messageErreur(corps: unknown, status: number): string {
  const m = (corps as { message?: string | string[] })?.message;
  if (Array.isArray(m)) return m.join(' · ');
  if (typeof m === 'string') return m;
  if (status === 413) return 'Fichiers trop volumineux (50 Mo maximum par fichier).';
  return `Erreur ${status}`;
}

/** Appel à l'API NestJS (via le relais /api du frontend). Rafraîchit la session une fois si expirée. */
export async function api<T = unknown>(chemin: string, init: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const { json, ...reste } = init;
  const opts: RequestInit = { credentials: 'same-origin', ...reste };
  if (json !== undefined) {
    opts.body = JSON.stringify(json);
    opts.headers = { 'Content-Type': 'application/json', ...(reste.headers || {}) };
  }
  const r = await fetch(`/api${chemin}`, opts);
  if (r.status === 401 && retry && !chemin.startsWith('/auth/login') && !chemin.startsWith('/auth/refresh')) {
    if (await rafraichir()) return api<T>(chemin, init, false);
  }
  if (!r.ok) {
    let corps: unknown = null;
    try { corps = await r.json(); } catch { /* vide */ }
    const msg = messageErreur(corps, r.status);
    if (r.status === 401 && typeof window !== 'undefined' && !chemin.startsWith('/auth/')) {
      window.location.href = '/connexion';
    }
    if (r.status === 403 && msg.includes('Changement de mot de passe') && typeof window !== 'undefined') {
      window.location.href = '/mot-de-passe';
    }
    throw new ApiError(r.status, msg);
  }
  if (r.status === 204) return undefined as T;
  const type = r.headers.get('content-type') || '';
  return (type.includes('json') ? r.json() : r.blob()) as Promise<T>;
}

/**
 * Envoi multipart avec suivi de progression (fetch ne sait pas suivre un envoi, XMLHttpRequest si).
 * `progression` reçoit une fraction entre 0 et 1.
 */
export function envoyer<T = unknown>(chemin: string, corps: FormData, progression: (fraction: number) => void, retry = true): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${chemin}`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) progression(e.loaded / e.total); };
    xhr.onload = async () => {
      if (xhr.status === 401 && retry && await rafraichir()) {
        progression(0);
        envoyer<T>(chemin, corps, progression, false).then(resolve, reject);
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
      else reject(new ApiError(xhr.status, messageErreur(xhr.response, xhr.status)));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Le serveur est injoignable. Vérifiez la connexion réseau puis réessayez.'));
    xhr.send(corps);
  });
}

export async function telecharger(chemin: string, nomFichier: string) {
  const blob = await api<Blob>(chemin);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomFichier; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
