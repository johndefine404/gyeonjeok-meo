-- [Define404] 가입·로그인 때 체크한 광고 수신 동의(선택)를 로그인 링크에 묶어 둔다.
-- 메일 주인이 링크로 로그인을 마친 뒤에만 동의로 기록한다 (남의 메일 주소로 동의를 켜지 못하게)
ALTER TABLE login_tokens ADD COLUMN marketing INTEGER NOT NULL DEFAULT 0;
