#!/usr/bin/env python3
"""test_audit_scoring_email_placeholder.py — Issue #134.

`validate_participants()` in audit_scoring.py rejected any email-shaped value without "@" as
invalid -- including data.js's own documented "no email on file" placeholder (`"—"`, an em-dash).
Dormant today only because data.js currently has zero `email:` fields at all; if email data with
any missing-email participant were ever reintroduced, this would have permanently failed the
mandatory pre-send scoring audit for an unrelated reason.

Executes the real, unmodified `validate_participants()` -- doesn't reimplement its logic.

Executar: python3 bolao/loterias/powerball/scripts/test_audit_scoring_email_placeholder.py
NENHUM ENDERECO REAL: so dominios reservados por RFC 2606.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_scoring as A


def _entry(name, email):
    return f'{{name: "{name}", email: "{email}"}}'


class EmailPlaceholderExemption(unittest.TestCase):
    def test_placeholder_participant_passes(self):
        data = _entry("Fulano", A.NO_EMAIL_ON_FILE_PLACEHOLDER)
        self.assertTrue(A.validate_participants(data),
                        "the documented 'no email on file' placeholder was rejected as invalid")

    def test_genuinely_malformed_email_still_fails(self):
        data = _entry("Fulano", "not-an-email")
        self.assertFalse(A.validate_participants(data),
                         "a genuinely malformed (non-placeholder) email was not caught")

    def test_valid_email_still_passes(self):
        data = _entry("Fulano", "fulano@example.invalid")
        self.assertTrue(A.validate_participants(data))

    def test_mixed_placeholder_and_valid_passes(self):
        data = _entry("Fulano", A.NO_EMAIL_ON_FILE_PLACEHOLDER) + "\n" + \
               _entry("Ciclano", "ciclano@example.invalid")
        self.assertTrue(A.validate_participants(data),
                        "a placeholder participant alongside a valid one should still pass")


if __name__ == "__main__":
    unittest.main(verbosity=2)
