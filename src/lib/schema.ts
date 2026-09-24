/**
 * The database schema version this frontend expects (ARCHITECTURE §18).
 * Every migration bumps `schema_version`; bump this number in the same pull request.
 * `npm run test:sql` fails when the two disagree.
 */
export const EXPECTED_SCHEMA_VERSION: number = 10;
