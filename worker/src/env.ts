// [Define404] Worker 환경 바인딩 타입
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  LIMITER?: RateLimit;

  APP_NAME: string;
  CTA_URL: string;
  MAIL_FROM: string;
  DEV_MODE?: string;

  RESEND_API_KEY?: string;
}

export type Account = {
  id: string;
  email: string;
  marketing_consent: number;
};

export type Vars = { account: Account | null };

export type AppEnv = { Bindings: Env; Variables: Vars };
