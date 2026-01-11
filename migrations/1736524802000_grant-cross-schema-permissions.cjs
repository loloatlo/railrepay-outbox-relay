/**
 * Migration: Grant cross-schema permissions for outbox-relay
 * 
 * NOTE: Railway PostgreSQL uses postgres as the default user/role
 * so permissions are already granted. This migration is for documentation.
 */

exports.up = (pgm) => {
  // Grant SELECT permission (read unpublished events)
  // These grants will fail silently if tables don't exist yet
  pgm.sql(`
    DO $$
    BEGIN
      -- whatsapp_handler
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'whatsapp_handler' AND table_name = 'outbox_events') THEN
        GRANT SELECT, UPDATE ON whatsapp_handler.outbox_events TO postgres;
      END IF;

      -- journey_matcher
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'journey_matcher' AND table_name = 'outbox') THEN
        GRANT SELECT, UPDATE ON journey_matcher.outbox TO postgres;
      END IF;

      -- darwin_ingestor
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'darwin_ingestor' AND table_name = 'outbox') THEN
        GRANT SELECT, UPDATE ON darwin_ingestor.outbox TO postgres;
      END IF;

      -- timetable_loader
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'timetable_loader' AND table_name = 'outbox') THEN
        GRANT SELECT, UPDATE ON timetable_loader.outbox TO postgres;
      END IF;

      -- data_retention
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'data_retention' AND table_name = 'outbox') THEN
        GRANT SELECT, UPDATE ON data_retention.outbox TO postgres;
      END IF;
    END
    $$;
  `);
};

exports.down = (pgm) => {
  // Revoke is optional since postgres user has full permissions
  pgm.sql(`SELECT 1`);
};
