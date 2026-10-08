// [Define404] 광고성 정보 수신 동의: 2년 유효기간, 처리 결과 안내 메일, 보관 기간
// 근거: 정보통신망법 50조 (7항 처리 결과 통지, 8항과 시행령의 2년마다 재확인), 개인정보 보호법 15조·22조

/** 광고성 정보 수신 동의는 동의(또는 다시 동의)한 날부터 2년이 지나면 자동으로 끈다 */
export const MARKETING_TTL_MS = 2 * 365 * 86_400_000 + 86_400_000; // 2년 (윤년 하루 여유)
/** 로그인을 마치지 않은 가입 메일 주소를 지우기까지 */
export const UNVERIFIED_TTL_MS = 7 * 86_400_000;
/** 견적 요청 페이지로 받은 고객 요청을 지우기까지 (접수일 기준) */
export const REQUEST_TTL_MS = 365 * 86_400_000;

/** 지금 광고 메일을 보내도 되는 동의 상태인가 (켜져 있고 2년이 지나지 않음) */
export function marketingActive(flag: number | boolean | null | undefined, atIso: string | null | undefined, now = Date.now()): boolean {
  if (!flag || !atIso) return false;
  const at = Date.parse(atIso);
  return Number.isFinite(at) && now - at < MARKETING_TTL_MS;
}

/** 2년이 지나 꺼야 하는 기준 시각 (이보다 앞선 동의는 만료) */
export const marketingCutoffIso = (now = Date.now()) => new Date(now - MARKETING_TTL_MS).toISOString();

export type NoticeKind = "consent" | "withdraw" | "expired";

/**
 * 동의·철회·만료 처리 결과 안내 메일 (정보통신망법 50조 7항). 광고가 아니므로 광고 문구를 넣지 않는다.
 * when 은 한국 시간 문자열 ("2026-10-09 14:05")
 */
export function marketingNotice(o: {
  kind: NoticeKind;
  when: string;
  email: string;
  app: string;
  operator: string;
  contact: string;
  appUrl: string; // 비어 있으면 링크 없이 쓴다 (정기 작업에서 APP_URL 을 정하지 않은 경우)
  offUrl?: string;
}): { subject: string; text: string } {
  const app = o.appUrl ? `: ${o.appUrl}` : "";
  const result = {
    consent: "광고성 정보 수신에 동의하셨습니다",
    withdraw: "광고성 정보 수신 동의를 철회하셨습니다. 이제 광고 메일을 보내지 않습니다",
    expired: "광고성 정보 수신에 동의하신 지 2년이 지나 동의를 자동으로 껐습니다. 이제 광고 메일을 보내지 않습니다",
  }[o.kind];
  const lines = [
    `${o.operator}에서 ${o.app} 광고성 정보 수신 동의 처리 결과를 알려 드립니다.`,
    ``,
    `처리 결과: ${result}`,
    `처리 일시: ${o.when} (한국 시간)`,
    `대상 메일: ${o.email}`,
    ``,
  ];
  if (o.kind === "consent") {
    lines.push(
      `보내는 내용: ${o.operator}의 새 기능, 설치·맞춤 제작 안내 메일`,
      `동의한 날부터 2년이 지나면 자동으로 꺼집니다. 계속 받으시려면 그때 내 견적함에서 다시 켜 주세요.`,
      `광고 메일은 밤 9시부터 아침 8시 사이에는 보내지 않습니다.`,
      ``,
      `수신을 끄려면 아래 링크를 누르세요. 바로 꺼지고 비용은 들지 않습니다.`,
      o.offUrl ?? `내 견적함${app}`,
      `내 견적함에서도 끌 수 있습니다${app}`,
      `본인이 신청하지 않았다면 위 링크로 꺼 주세요.`,
    );
  } else {
    lines.push(`다시 받으시려면 내 견적함에서 켤 수 있습니다${app}`);
  }
  lines.push(``, `보낸 곳: ${o.operator}`, `문의: ${o.contact}`);
  return { subject: `[${o.app}] 광고성 정보 수신 동의 처리 결과`, text: lines.join("\n") };
}
