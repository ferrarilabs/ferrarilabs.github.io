"""
reopen_after_r32.py — Bolão Ferrari Copa 2026

Roda 5 minutos após o último jogo da R32 (M88).
Reabre o site APENAS no modo edit-by-code (sem aceitar novas entradas).

Usage:
  python3 reopen_after_r32.py         # atualiza config + commit + push

O que faz:
  1. Define r32CutoffIso = agora (edit-by-code abre imediatamente)
  2. Define cutoffIso = 4 jul 2026 12:00 PM ET (janela fecha meio-dia)
  3. Define cutoffLabel atualizado
  4. Salva config.js, faz commit e push

Roda de: /Users/eduardoferrari/Documents/GitHub/ferrarilabs.github.io/
"""

import re, subprocess, sys
from datetime import datetime, timezone, timedelta

REPO = "/Users/eduardoferrari/Documents/GitHub/ferrarilabs.github.io"
CONFIG = f"{REPO}/bolao-teste/js/config.js"

# Janela de edição: abre AGORA, fecha 4 jul meio-dia ET
ET = timezone(timedelta(hours=-4))
now_et = datetime.now(ET)
r32_open = now_et.strftime("%Y-%m-%dT%H:%M:%S-04:00")
edit_close = "2026-07-04T12:00:00-04:00"
label = "Sábado, 4/jul/2026 às 12:00 PM ET"

print(f"r32CutoffIso  → {r32_open}  (agora — edit abre imediatamente)")
print(f"cutoffIso     → {edit_close}  (janela fecha aqui)")

with open(CONFIG) as f:
    text = f.read()

# Patch r32CutoffIso
text = re.sub(
    r'r32CutoffIso:\s*"[^"]*"',
    f'r32CutoffIso: "{r32_open}"',
    text
)
# Patch cutoffIso
text = re.sub(
    r'cutoffIso:\s*"[^"]*"',
    f'cutoffIso: "{edit_close}"',
    text
)
# Patch cutoffLabel
text = re.sub(
    r'cutoffLabel:\s*"[^"]*"',
    f'cutoffLabel: "{label}"',
    text
)
# Bump siteVersion minor
def bump(m):
    ver = m.group(1)
    parts = ver.split(".")
    if len(parts) == 2:
        major, minor = parts
        try:
            return f'siteVersion: "v{major}.{int(minor)+1}"'
        except ValueError:
            pass
    return m.group(0)

text = re.sub(r'siteVersion:\s*"v(\d+\.\d+)"', bump, text)

with open(CONFIG, "w") as f:
    f.write(text)

print(f"\nconfig.js atualizado.")

# Commit + push
cmds = [
    ["git", "-C", REPO, "add", "bolao-teste/js/config.js"],
    ["git", "-C", REPO, "commit", "-m",
     f"reopen edit window after R32 final\n\nr32CutoffIso={r32_open}\ncutoffIso={edit_close}"],
    ["git", "-C", REPO, "push"],
]
for cmd in cmds:
    result = subprocess.run(cmd, capture_output=True, text=True)
    print(" ".join(cmd[2:] if cmd[1] == "-C" else cmd))
    if result.stdout.strip(): print(result.stdout.strip())
    if result.stderr.strip(): print(result.stderr.strip())
    if result.returncode != 0:
        print(f"ERRO (code {result.returncode}) — verifique e rode manualmente.")
        sys.exit(1)

print("\n✓ Site reaberto em modo edit-by-code. Fecha 4/jul às 12:00 PM ET.")
