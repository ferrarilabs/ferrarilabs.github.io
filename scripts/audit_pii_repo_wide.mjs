#!/usr/bin/env node
// audit_pii_repo_wide.mjs — Repo-wide PII / secret regression guard.
//
// Thin CLI over scripts/pii_detectors.mjs. O motor de deteccao vive la para poder ser testado;
// este arquivo so decide QUAIS arquivos varrer e como sair.
//
// Varre todo arquivo RASTREADO pelo git (`git ls-files`, entao caminhos ignorados e nao rastreados
// ficam de fora sem lista de excecao mantida a mao).
//
// Nunca imprime um valor encontrado — apenas caminho, detector, contagem e um preview mascarado
// (primeiro char + ultimo char + tamanho), conforme o mandato permanente: "nao imprimir os valores
// encontrados".
//
// ═══ ESTE ARQUIVO E O RESULTADO DE UMA RECONCILIACAO CROSS-WORKSTREAM (2026-08-12) ═══════════
//
// Dois workstreams editaram esta mesma superficie, por motivos diferentes, e ambos estavam certos:
//
//   - A campanha de DB extraiu os detectores para `pii_detectors.mjs` para que o motor pudesse ter
//     um suite de testes proprio (`test_pii_detectors.mjs`), e reduziu este arquivo a um CLI.
//   - Main endureceu a SEMANTICA dos detectores no arquivo monolitico: removeu `@email.com` da
//     allowlist (dominio de webmail VIVO — suprimia 11 enderecos reais), adicionou o detector
//     `lottery-ticket-serial`, e criou o mecanismo de EXPOSICAO DECLARADA por caminho.
//
// Tomar qualquer um dos lados inteiro teria perdido o outro. Escolher a versao da campanha teria
// REINTRODUZIDO o falso negativo de `@email.com` e APAGADO o detector de serial de loteria — uma
// regressao de seguranca criada pela integracao, com os dois branches passando sozinhos.
//
// A reconciliacao: o refactor da campanha foi preservado (motor testavel + CLI fino) E as duas
// correcoes de main foram portadas PARA DENTRO do motor. Ver os comentarios em `pii_detectors.mjs`
// sobre RESERVED_EMAIL_SUFFIXES e DECLARED_EXPOSURES.
//
// Este modulo REEXPORTA `isAllowedEmail`, `mask` e `ALLOWED_EMAIL_SUFFIXES` com os nomes que main
// usava, porque `scripts/test_audit_pii_repo_wide.mjs` (de main) importa exatamente esses tres e
// deve continuar passando SEM ser reescrito — ele e quem tranca o invariante do `@email.com`.
//
// Usage: node scripts/audit_pii_repo_wide.mjs

import { execSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  scanFiles,
  formatReport,
  isReservedEmail,
  mask,
  RESERVED_EMAIL_SUFFIXES,
} from "./pii_detectors.mjs";

// ── Compatibilidade de nomes com o gate que vivia em main ────────────────────────────────────
// Mesma funcao, mesmo dado, nome antigo. Nao duplicar a logica: reexportar.
export { mask };
export const ALLOWED_EMAIL_SUFFIXES = RESERVED_EMAIL_SUFFIXES;
export const isAllowedEmail = isReservedEmail;

// O motor de detecao e o proprio suite dele contem os padroes como assunto. Isto e bem mais estreito
// que a lista de arquivos pulados que substituiu: nomeia so os arquivos onde o padrao E o conteudo,
// e todo o resto — inclusive todo arquivo de fixture — e varrido por inteiro, com declaracoes por
// detector onde uma fixture deliberada e inevitavel.
const DETECTOR_SOURCES = [
  "scripts/pii_detectors.mjs",
  "scripts/test_pii_detectors.mjs",
  "scripts/audit_pii_repo_wide.mjs",
  "scripts/test_audit_pii_repo_wide.mjs",
  "bolao/loterias/powerball/scripts/audit_pii_tests.mjs",
];

function trackedFiles() {
  return execSync("git ls-files", { cwd: process.cwd(), encoding: "utf8" }).split("\n").filter(Boolean);
}

function main() {
  const result = scanFiles(trackedFiles(), (f) => readFileSync(f, "utf8"), { detectorSources: DETECTOR_SOURCES });
  const report = formatReport(result);
  if (!result.ok) { console.error(report); process.exit(1); }
  console.log(report);
}

// So varre quando executado diretamente. Importar este modulo (do teste, por exemplo) nao pode
// executar o scan — invariante herdado de main e mantido de proposito.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main();
}
