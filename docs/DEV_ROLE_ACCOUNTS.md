# Fictional development accounts

These reserved `.test` accounts are for local development only. They are not real users and must never be created in a production database. A fictional student patient is linked to the guardian account; students do not sign in to HealthMate+.

| Role | Email | Password |
| --- | --- | --- |
| System administrator | `admin@healthmate.test` | `DevAdmin-92!Mango-Slate` |
| School nurse | `nurse@healthmate.test` | `DevNurse-47!Cedar-Cloud` |
| Guardian | `guardian@healthmate.test` | `DevGuardian-26!Birch-Stone` |

Login OTP can be disabled for local development with `REQUIRE_LOGIN_OTP=false` in a development environment.

## Check and seed

First run the read-only database check:

```sh
npm run db:preflight-dev-accounts
```

The read-only check verifies that none of the three reserved account identifiers or the development patient ID already belongs to another record. Existing users and clinic records are left untouched. Review the result and confirm that the database is a disposable development target before seeding.

After confirming the target is disposable, seed with both development safeguards enabled:

```sh
NODE_ENV=development SEED_DEV_ROLE_ACCOUNTS=true npm run db:seed-dev-accounts
```

The command runs in one transaction. It creates a separate fictional student patient and links the guardian account to that patient. It refuses identifier collisions and never attaches the development guardian to an existing patient. Re-running it refreshes passwords only for accounts recorded in its own seed registry, after verifying the seeded patient and guardian link still match. Do not run it against production.
