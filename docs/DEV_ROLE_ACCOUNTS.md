# Fictional development accounts

These reserved `.test` accounts are for local development only. They are not real users and must never be created in a production database. The student and guardian are linked only to a new, separate fictional patient; the nurse and administrator keep the access their roles provide.

| Role | Email | Password |
| --- | --- | --- |
| System administrator | `admin@healthmate.test` | `DevAdmin-92!Mango-Slate` |
| School nurse | `nurse@healthmate.test` | `DevNurse-47!Cedar-Cloud` |
| Student | `student@healthmate.test` | `DevStudent-83!Maple-River` |
| Guardian | `guardian@healthmate.test` | `DevGuardian-26!Birch-Stone` |

The student and guardian accounts are linked to the same fictional patient. Login OTP can be disabled for local development with `REQUIRE_LOGIN_OTP=false` in a development environment.

## Check and seed

First run the read-only database check:

```sh
npm run db:preflight-dev-accounts
```

The read-only check verifies that none of the four reserved account identifiers or the development patient ID already belongs to another record. Existing users and clinic records are left untouched. Review the result and confirm that the Supabase project or local database is a development target before seeding.

After confirming the target is disposable, seed with both development safeguards enabled:

```sh
SEED_DEV_ROLE_ACCOUNTS=true npm run db:seed-dev-accounts
```

The command runs in one transaction. It creates a separate fictional patient and links the student and guardian accounts to that patient. It refuses identifier collisions and never attaches these accounts to existing patients. Re-running it refreshes passwords only for accounts recorded in its own seed registry, after verifying the seeded patient and links still match. Do not run it against production.
