# Compatibility Notes

Some source identifiers still use inherited names such as `@superset/*`, `SUPERSET_*`, `ADE_*`, and `.ade`.

These are retained intentionally in version 0.8 because they affect workspace package resolution, local database migrations, application-data paths, environment compatibility, and existing user installations. They are internal compatibility identifiers and do not represent public branding or affiliation.

A future migration should introduce aliases first, migrate stored paths and database records, and only then remove legacy identifiers. Avoid global search-and-replace changes.
