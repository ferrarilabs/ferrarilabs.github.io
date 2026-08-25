// Powerball lottery pool configuration
// Shared with Copa/BR2026/CDB2026 EmailJS service

window.POWERBALL_CONFIG = {
  /**
   * Reportar problema (Issue #321). DESLIGADO ate a provisao de producao estar completa.
   *
   * A UI so aparece quando isto e `true`. Sem o endpoint implantado, um botao visivel seria um
   * botao morto -- pior que nao ter botao, porque ensina o participante que reportar nao funciona.
   */
  reportProblem: {
    // LIGADO em 2026-08-25 (#321). Estado canonico: bolao/shared/safety/report_rollout.json.
    enabled: true,
    // Endereco do Cloudflare Worker isolado (`ferrarilabs-support-intake`, ADR-021).
    //
    // A decisao de endereco foi tomada em 2026-08-25: `workers.dev`, porque a conta Cloudflare tem
    // `zones = 0` e um subdominio proprio exigiria mover o DNS de `ferrarilabs.com` inteiro. Ver
    // ADR-021 ("Endereco publico").
    //
    // PREENCHER AQUI NAO LIGA NADA. Sao duas chaves independentes, e esta e a mais fraca:
    //   - `enabled: false` (abaixo) -> a UI nao monta, nao ha botao;
    //   - `REPORT_INTAKE_ENABLED != "true"` no Worker -> toda requisicao morre em 503 antes de
    //     tocar qualquer dependencia.
    // O rollback comeca SEMPRE pelo servidor: apagar esta URL so esconde o botao, e um navegador
    // com a pagina em cache continua conseguindo POSTar.
    endpoint: "https://ferrarilabs-support-intake.automotive-dashboard-private-status.workers.dev/",
  },
  emailjs: {
    enabled: true,
    publicKey: "GBZFujsJBET6modve",
    serviceId: "service_o4hyzxr",
    participantTemplateId: "template_xq7yzzb",
    adminTemplateId: "template_4sgp5r9"
  },
  adminEmail: "emferrari@gmail.com"
};

// Initialize EmailJS on load
if (window.emailjs) {
  emailjs.init(POWERBALL_CONFIG.emailjs.publicKey);
}
