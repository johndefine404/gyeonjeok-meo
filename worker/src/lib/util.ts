// [Define404] 난수 ID, 해시, 시간, 입력 정리

const B64URL = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 추측할 수 없는 ID (기본 16바이트 = 128비트) */
export function randomId(bytes = 16): string {
  return B64URL(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** 견적 요청 페이지 주소용: 헷갈리는 글자를 뺀 소문자 10자 (약 50비트) */
export function randomSlug(len = 10): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint8Array(len));
  return [...r].map((b) => abc[b % abc.length]).join("");
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const SLUG_RE = /^[a-z0-9]{10}$/;
export const EMAIL_RE = /^[^\s@<>()"',;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

export const nowIso = () => new Date().toISOString();

/** 한국 시간 YYYYMMDD */
export function kstYmd(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
}

/** 한국 시간 "2026-10-09 14:05" */
export function kstText(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

export const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
