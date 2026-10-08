"""[Define404] 견적냥 로고: 부킹냥(booking-meo)과 같은 고양이 머리 도형에 견적냥 색을 입힌다.
사용: python3 tools/make-logo.py   → public/logo.svg, public/favicon.svg
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
W = H = 120
BRAND = "#0A6797"  # 화면 강조색(site.css --accent)과 같다
WHITE = "#FFFFFF"
INNER = "#FFB6A3"
DARK = "#2A211D"
WHISKER = "#D8CFCA"

# 도형 정의 (booking-meo/tools/make-mascot.py 와 같다)
EAR_L = [(27, 56), (33, 20), (55, 42)]
EAR_R = [(93, 56), (87, 20), (65, 42)]
IN_L = [(34, 48), (36, 30), (48, 42)]
IN_R = [(86, 48), (84, 30), (72, 42)]
HEAD = (60, 68, 80, 66)
EYES = [(46, 67, 9, 11), (74, 67, 9, 11)]
NOSE = [(56, 75), (64, 75), (60, 80)]
MOUTH = [[(60, 80), (55, 84)], [(60, 80), (65, 84)]]
WHISKERS = [[(24, 74), (40, 76)], [(25, 82), (40, 80)], [(96, 74), (80, 76)], [(95, 82), (80, 80)]]


def pts(p):
    return " ".join(f"{x},{y}" for x, y in p)


def cat_svg():
    parts = [
        f'<polygon points="{pts(EAR_L)}" fill="{WHITE}"/>',
        f'<polygon points="{pts(IN_L)}" fill="{INNER}"/>',
        f'<polygon points="{pts(EAR_R)}" fill="{WHITE}"/>',
        f'<polygon points="{pts(IN_R)}" fill="{INNER}"/>',
        f'<ellipse cx="{HEAD[0]}" cy="{HEAD[1]}" rx="{HEAD[2] / 2}" ry="{HEAD[3] / 2}" fill="{WHITE}"/>',
    ]
    parts += [f'<ellipse cx="{x}" cy="{y}" rx="{w / 2}" ry="{h / 2}" fill="{DARK}"/>' for x, y, w, h in EYES]
    parts.append(f'<polygon points="{pts(NOSE)}" fill="{INNER}"/>')
    parts += [f'<polyline points="{pts(m)}" fill="none" stroke="{DARK}" stroke-width="2" stroke-linecap="round"/>' for m in MOUTH]
    parts += [f'<polyline points="{pts(w)}" fill="none" stroke="{WHISKER}" stroke-width="2" stroke-linecap="round"/>' for w in WHISKERS]
    return "".join(parts)


svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
       f'<circle cx="60" cy="60" r="60" fill="{BRAND}"/>{cat_svg()}</svg>\n')
(ROOT / "public" / "logo.svg").write_text(svg)
(ROOT / "public" / "favicon.svg").write_text(svg)
print("ok")
