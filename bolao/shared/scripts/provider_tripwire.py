#!/usr/bin/env python3
"""Tripwire de provedor: a UNICA definicao de "nada aqui fala com o provedor de e-mail".

═══ POR QUE ISTO EXISTE ═════════════════════════════════════════════════════════════════════════

Em 2026-08-12 o operador recebeu QUATRO e-mails do CDB em 45 minutos. Os dois ultimos nao vieram
do defeito que estava sendo consertado — vieram dos VERIFICADORES. O operador e participante, nao
caixa de teste.

O gate `bolao/scripts/test_no_real_email_in_verification.py` fechou essa porta com uma regra dura
e certa: NENHUM arquivo de verificacao (`test_`/`audit_`/`check_`/canary/probe) pode mencionar o
provedor. A regra e estatica e nao tem excecao — e e justamente por nao ter excecao que ela vale
alguma coisa.

Mas um teste seguro precisa de uma sentinela que LEVANTE se alguem tentar falar com o provedor —
e escrever essa sentinela exige escrever o nome do host. O teste ficava preso entre duas coisas
certas: ter a trava, e nao citar o provedor.

A saida NAO e afrouxar o gate, nem renomear o arquivo para escapar do padrao (as duas trocariam
uma protecao real por um verde). A saida e tirar o literal de dentro dos verificadores e deixa-lo
num lugar so, auditado, que existe exatamente para BLOQUEAR — nunca para chamar.

Este arquivo e esse lugar.

═══ O QUE ELE GARANTE ═══════════════════════════════════════════════════════════════════════════

`install()` substitui `urllib.request.urlopen` por uma guarda que:

  · LEVANTA `ProviderReachedError` para qualquer host de provedor de e-mail;
  · deixa passar o resto da rede (PostgREST, ESPN, data.ny.gov), porque um teste de integracao
    legitimo precisa do banco — bloquear tudo obrigaria cada teste a inventar a propria excecao,
    e excecao inventada caso a caso e como a protecao se dissolve.

O proprio gate EXECUTA esta guarda e exige que ela levante (ver `tripwire_bloqueia_provedor`).
Enfraquece-la para deixar passar torna o gate VERMELHO. Nao e uma declaracao de que o arquivo e
seguro — e uma prova comportamental, refeita a cada execucao.

Uso:
    from provider_tripwire import install
    install()                      # a partir daqui, falar com o provedor levanta
"""
import urllib.request

# Hosts de provedor de e-mail. Montados por partes de proposito: o gate que varre o repositorio
# procura o literal do provedor em codigo de verificacao, e este arquivo NAO e verificacao — mas
# manter o literal partido deixa explicito que aqui ninguem constroi uma URL para CHAMAR, so para
# COMPARAR. Quem quiser enviar de verdade usa um sender registrado, nunca isto.
_HOSTS = (
    "api." + "emailjs" + ".com",
    "api." + "sendgrid" + ".com",
    "api." + "mailgun" + ".net",
)


class ProviderReachedError(AssertionError):
    """Alguem tentou falar com o provedor de dentro de um verificador."""


def alvo_e_provedor(url):
    """True quando a URL aponta para um provedor de e-mail."""
    u = str(url or "")
    return any(h in u for h in _HOSTS)


def install():
    """Arma a sentinela. Idempotente: instalar duas vezes nao empilha guardas."""
    real = getattr(urllib.request.urlopen, "_tripwire_real", urllib.request.urlopen)

    def guarda(req, *a, **k):
        alvo = req.full_url if hasattr(req, "full_url") else str(req)
        if alvo_e_provedor(alvo):
            raise ProviderReachedError(
                "TENTATIVA DE ENVIO REAL DENTRO DE UM VERIFICADOR — transporte falso ausente. "
                f"alvo={alvo!r}. Verificador nao fala com provedor, em nenhuma circunstancia."
            )
        return real(req, *a, **k)

    guarda._tripwire_real = real
    urllib.request.urlopen = guarda
    return guarda
