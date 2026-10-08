-- [Define404] gyeonjeok-meo 초기 스키마

-- 메일 가입 계정 (= Define404 리드). 비밀번호는 없다: 메일 로그인 링크만 쓴다
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  privacy_consent_at TEXT NOT NULL,       -- 필수: 개인정보 수집·이용 동의 시각
  marketing_consent INTEGER NOT NULL DEFAULT 0, -- 선택: 광고성 정보 수신 동의 (정보통신망법 50조)
  marketing_consent_at TEXT,              -- 동의 또는 철회한 시각
  verified_at TEXT,                       -- 메일 링크로 처음 로그인한 시각
  created_at TEXT NOT NULL
);

-- 메일 로그인 링크. 원문 토큰은 저장하지 않고 SHA-256만 둔다
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX login_tokens_account ON login_tokens(account_id, created_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);

-- 사업자 정보 (계정 하나에 하나). slug = 견적 요청 페이지 주소
CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  biz_no TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notify_email TEXT NOT NULL DEFAULT '',  -- 비우면 가입 메일로 알림
  intro TEXT NOT NULL DEFAULT '',         -- 견적 요청 페이지 소개 문구
  seq_date TEXT NOT NULL DEFAULT '',      -- 견적 번호 날짜 (YYYYMMDD, 한국 시간)
  seq INTEGER NOT NULL DEFAULT 0,         -- 그날 몇 번째 견적인지
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 저장한 견적서. id 자체가 공유 링크의 비밀값이다 (128비트 난수)
CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  data TEXT NOT NULL,                     -- normalizeQuote 결과 JSON (직인 제외)
  total INTEGER NOT NULL,
  client_name TEXT NOT NULL,
  accepted_at TEXT,
  accepted_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX quotes_business ON quotes(business_id, created_at);

-- 견적 요청 페이지(/r/<slug>)로 들어온 고객 요청
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  details TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX requests_business ON requests(business_id, created_at);
CREATE INDEX requests_ip ON requests(ip_hash, created_at);
