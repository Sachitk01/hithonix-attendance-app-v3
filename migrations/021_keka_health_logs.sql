CREATE TABLE keka_health_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checked_at timestamptz DEFAULT now(),
    oauth_ok boolean NOT NULL,
    hris_ok boolean NOT NULL,
    ingestion_ok boolean NOT NULL,
    error_details text
);
