-- Required by the GIN trigram index on resources.name (idx_resources_name_trgm).
-- Must run before the resources table migration. On RDS this needs the
-- rds_superuser/master role (or pre-create the extension out-of-band).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
