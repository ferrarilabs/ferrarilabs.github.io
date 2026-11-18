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
  // Participantes AO VIVO do sorteio aberto (js/live_participants.js). O site le o banco pela RPC
  // publica `lottery_public_open_draws` e cai no data.js se ela falhar. Desligar = `enabled: false`
  // (o data.js volta a ser a unica fonte, como antes de 2026-11-18).
  liveDb: {
    enabled: true,
    url: "https://cmhqkkfczotdnssupkni.supabase.co",
    // Chave PUBLICA (a mesma dos outros tres bolões); nao da acesso a tabela nenhuma.
    anonKey: "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5",
    timeoutMs: 6000,
    // So a origem de PRODUCAO le o banco. Servidor local e testes de navegador ficam no data.js:
    // sem rede, deterministicos, e sem chamar o banco de producao a cada execucao da suite.
    origins: ["https://www.ferrarilabs.com"]
  },
  adminEmail: "emferrari@gmail.com"
};

// Initialize EmailJS on load
if (window.emailjs) {
  emailjs.init(POWERBALL_CONFIG.emailjs.publicKey);
}
