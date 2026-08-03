// Powerball lottery pool configuration
// Shared with Copa/BR2026/CDB2026 EmailJS service

window.POWERBALL_CONFIG = {
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
