Workflows parked on 2026-10-07 as step 1 of the corporate/personal repository split.
They now run from the dedicated non-company repository. Do not move them back.
TEMPORARY EXCEPTION: one workflow stays active in .github/workflows/ until its private
data secret is recreated in the destination repository. It stays PARKED in the destination
so it never runs twice. Final step (separate reviewed PR): remove this directory and the exception.
