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
    enabled: false,
    // Endpoint definido no momento da ATIVACAO, nao antes.
    //
    // O intake mudou de runtime: o alvo deixou de ser a Edge Function do projeto Supabase que
    // guarda participante, pagamento e scoring, e passou a ser um Cloudflare Worker isolado
    // (`ferrarilabs-support-intake`, ADR-021). O endereco publico dele depende de uma decisao do
    // dono que ainda nao foi tomada -- `workers.dev` ou um subdominio proprio -- entao deixar aqui
    // a URL antiga apontaria o cliente para exatamente o runtime que a migracao existe para
    // abandonar.
    //
    // Vazio e o estado correto: `montar()` desiste sem endpoint, entao nao existe botao morto.
    endpoint: "",
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
