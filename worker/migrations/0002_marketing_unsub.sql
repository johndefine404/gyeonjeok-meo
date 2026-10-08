-- [Define404] 광고 수신 거부 링크용 토큰 (계정마다 하나). 이 토큰으로는 수신 동의를 끄는 것만 할 수 있다
ALTER TABLE accounts ADD COLUMN unsub_token TEXT;
CREATE UNIQUE INDEX accounts_unsub ON accounts(unsub_token);
-- 2년 만료 점검용
CREATE INDEX accounts_marketing ON accounts(marketing_consent, marketing_consent_at);
