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
    endpoint: "https://cmhqkkfczotdnssupkni.supabase.co/functions/v1/user-report-intake",
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
